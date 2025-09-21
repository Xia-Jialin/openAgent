package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/cloudwego/eino-ext/components/model/openai"
	"github.com/cloudwego/eino/components/tool"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/gorilla/websocket"
	"github.com/joho/godotenv"

	"openAgent/agent"
	"openAgent/storage"
	mytool "openAgent/tool"

	toolMcp "github.com/cloudwego/eino-ext/components/tool/mcp"
	"github.com/mark3labs/mcp-go/client"
	"github.com/mark3labs/mcp-go/client/transport"
	"github.com/mark3labs/mcp-go/mcp"
)

var (
	sessions = make(map[string]agent.Agent)
	mu       sync.Mutex
	dbStore  *storage.Storage

	// WebSocket related variables
	wsUpgrader = websocket.Upgrader{
		CheckOrigin: func(r *http.Request) bool {
			return true // Allow all origins for development
		},
	}
	previewClients = make(map[string]*websocket.Conn) // session_id -> websocket connection
	previewMutex   sync.RWMutex
)

const baseSystemPrompt = `
You are OpenAgent, a specialized AI assistant for web development, focused on creating HTML, CSS, and JavaScript applications. Your primary role is to help users build complete web applications with proper structure and functionality.

## Core Capabilities:
- Create complete web applications using HTML, CSS, and JavaScript
- Ensure every project includes an index.html file as the main entry point
- Build responsive, modern web interfaces with proper semantic HTML
- Write clean, maintainable CSS with modern best practices
- Develop interactive JavaScript functionality
- Implement proper file organization and project structure

## Web Development Guidelines:
- Always create a main index.html file for each project
- Use semantic HTML5 elements appropriately
- Implement responsive design principles
- Follow best practices for accessibility (WCAG)
- Write modular, reusable code
- Ensure cross-browser compatibility
- Implement proper error handling and user feedback

## Workspace Rules:
- You have a dedicated workspace for each project
- When using file-related tools (list_files, write_file, read_file, delete_file), all file paths should be relative to your workspace
- Do not use absolute paths
- Organize files in a logical structure (e.g., separate CSS and JS files)
- Keep related functionality grouped together

## Project Requirements:
- Every web application must have an index.html file
- Include proper DOCTYPE and meta tags
- Ensure all necessary files are created (HTML, CSS, JavaScript)
- Test that the application runs correctly in a browser
- Provide clear instructions on how to use/run the application

## Constraints:
- Focus only on web development tasks
- Do not create server-side code unless specifically requested
- Prioritize frontend technologies and user experience
- Ensure all created files are properly formatted and error-free
`

// 文件节点结构
type FileNode struct {
	Name     string     `json:"name"`
	Type     string     `json:"type"`
	Path     string     `json:"path"`
	Children []FileNode `json:"children,omitempty"`
}

// 扫描目录并构建文件树
func scanDirectory(basePath, currentPath string) ([]FileNode, error) {
	var files []FileNode

	entries, err := os.ReadDir(currentPath)
	if err != nil {
		return nil, err
	}

	for _, entry := range entries {
		// 跳过隐藏文件和目录
		if strings.HasPrefix(entry.Name(), ".") {
			continue
		}

		fullPath := filepath.Join(currentPath, entry.Name())
		relPath, err := filepath.Rel(basePath, fullPath)
		if err != nil {
			continue
		}

		if entry.IsDir() {
			// 递归扫描子目录
			children, err := scanDirectory(basePath, fullPath)
			if err != nil {
				continue
			}

			files = append(files, FileNode{
				Name:     entry.Name(),
				Type:     "folder",
				Path:     relPath,
				Children: children,
			})
		} else {
			// 添加文件
			files = append(files, FileNode{
				Name: entry.Name(),
				Type: "file",
				Path: relPath,
			})
		}
	}

	return files, nil
}

type MCPConfig struct {
	McpServers map[string]struct {
		Command string   `json:"command"`
		Args    []string `json:"args"`
	} `json:"mcpServers"`
}

// 读取mcp.json配置
func loadMCPConfig(path string) (*MCPConfig, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	var cfg MCPConfig
	dec := json.NewDecoder(f)
	if err := dec.Decode(&cfg); err != nil {
		return nil, err
	}
	return &cfg, nil
}

// 文件监控结构
type FileWatcher struct {
	sessions map[string]context.CancelFunc
	mu       sync.Mutex
}

var fileWatcher = &FileWatcher{
	sessions: make(map[string]context.CancelFunc),
}

// 监控文件变化
func (fw *FileWatcher) WatchFiles(sessionID, workDir string) {
	fw.mu.Lock()
	defer fw.mu.Unlock()

	// 如果已有监控，先取消
	if cancel, exists := fw.sessions[sessionID]; exists {
		cancel()
		delete(fw.sessions, sessionID)
	}

	ctx, cancel := context.WithCancel(context.Background())
	fw.sessions[sessionID] = cancel

	go func() {
		ticker := time.NewTicker(2 * time.Second) // 每2秒检查一次
		defer ticker.Stop()

		var lastFiles map[string]time.Time

		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				currentFiles := make(map[string]time.Time)
				filepath.Walk(workDir, func(path string, info os.FileInfo, err error) error {
					if err != nil {
						return nil
					}
					if !info.IsDir() && !strings.HasPrefix(filepath.Base(path), ".") {
						relPath, err := filepath.Rel(workDir, path)
						if err == nil {
							currentFiles[relPath] = info.ModTime()
						}
					}
					return nil
				})

				// 检查文件变化
				if lastFiles != nil {
					for path, modTime := range currentFiles {
						if lastModTime, exists := lastFiles[path]; !exists || modTime.After(lastModTime) {
							// 发送文件变化通知
							notifyFileChange(sessionID, path)
						}
					}
				}

				lastFiles = currentFiles
			}
		}
	}()
}

// 停止监控文件
func (fw *FileWatcher) StopWatching(sessionID string) {
	fw.mu.Lock()
	defer fw.mu.Unlock()

	if cancel, exists := fw.sessions[sessionID]; exists {
		cancel()
		delete(fw.sessions, sessionID)
	}
}

// 发送文件变化通知
func notifyFileChange(sessionID, filePath string) {
	previewMutex.RLock()
	conn, exists := previewClients[sessionID]
	previewMutex.RUnlock()

	if exists {
		message := map[string]interface{}{
			"type":     "file_change",
			"file":     filePath,
			"datetime": time.Now().Format(time.RFC3339),
		}

		if err := conn.WriteJSON(message); err != nil {
			log.Printf("Failed to send file change notification: %v", err)
			previewMutex.Lock()
			delete(previewClients, sessionID)
			previewMutex.Unlock()
		}
	}
}

// WebSocket处理器
func handleWebSocket(c *gin.Context) {
	sessionID := c.Query("session_id")
	if sessionID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "session_id is required"})
		return
	}

	// 升级为WebSocket连接
	conn, err := wsUpgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		log.Printf("WebSocket upgrade failed: %v", err)
		return
	}
	defer conn.Close()

	// 注册连接
	previewMutex.Lock()
	previewClients[sessionID] = conn
	previewMutex.Unlock()

	log.Printf("WebSocket client connected for session %s", sessionID)

	// 启动文件监控
	if agent, exists := sessions[sessionID]; exists {
		fileWatcher.WatchFiles(sessionID, agent.GetWorkDir())
	}

	// 保持连接活跃
	for {
		_, _, err := conn.ReadMessage()
		if err != nil {
			log.Printf("WebSocket client disconnected for session %s: %v", sessionID, err)
			break
		}
	}

	// 清理连接
	previewMutex.Lock()
	delete(previewClients, sessionID)
	previewMutex.Unlock()

	// 停止文件监控
	fileWatcher.StopWatching(sessionID)
}

// 启动MCP服务器并连接
func runMCPClient(ctx context.Context) []tool.BaseTool {
	cfg, err := loadMCPConfig("mcp.json")
	if err != nil {
		log.Fatalf("读取mcp.json失败: %v", err)
	}
	fmt.Println(cfg)

	allTools := []tool.BaseTool{}
	for _, server := range cfg.McpServers {
		stdioTransport := transport.NewStdio(server.Command, nil, server.Args...)

		c := client.NewClient(stdioTransport)

		err = c.Start(ctx)
		if err != nil {
			log.Fatalf("启动MCP客户端失败: %v", err)
		}
		initRequest := mcp.InitializeRequest{}
		initRequest.Params.ProtocolVersion = mcp.LATEST_PROTOCOL_VERSION
		initRequest.Params.ClientInfo = mcp.Implementation{
			Name:    "MCP-Go Simple Client Example",
			Version: "1.0.0",
		}
		initRequest.Params.Capabilities = mcp.ClientCapabilities{}
		serverInfo, err := c.Initialize(ctx, initRequest)
		if err != nil {
			log.Fatalf("Failed to initialize: %v", err)
		}
		fmt.Println(serverInfo)

		tools, err := toolMcp.GetTools(ctx, &toolMcp.Config{
			Cli: c,
		})
		if err != nil {
			panic(err)
		}
		fmt.Printf("%+v\n", tools)
		allTools = append(allTools, tools...)
	}
	return allTools
}

// 加载现有会话
func loadExistingSessions() {
	storedSessions, err := dbStore.GetAllSessions()
	if err != nil {
		log.Printf("Failed to load existing sessions: %v", err)
		return
	}

	mu.Lock()
	defer mu.Unlock()

	for _, session := range storedSessions {
		// 检查工作目录是否存在
		if _, err := os.Stat(session.WorkDir); os.IsNotExist(err) {
			log.Printf("Work directory %s does not exist for session %s, recreating...", session.WorkDir, session.ID)
			if err := os.MkdirAll(session.WorkDir, 0755); err != nil {
				log.Printf("Failed to recreate work directory for session %s: %v", session.ID, err)
				continue
			}
		}

		// 创建新的ChatModel实例
		apiKey := os.Getenv("OPENAI_API_KEY")
		modelName := os.Getenv("OPENAI_MODEL_NAME")
		baseURL := os.Getenv("OPENAI_BASE_URL")

		var temp float32 = 0.7
		newCm, err := openai.NewChatModel(context.Background(), &openai.ChatModelConfig{
			APIKey:      apiKey,
			BaseURL:     baseURL,
			Model:       modelName,
			Temperature: &temp,
		})
		if err != nil {
			log.Printf("Failed to create ChatModel for session %s: %v", session.ID, err)
			continue
		}

		// 加载工具
		allTools := runMCPClient(context.Background())
		deleteFileTool, _ := mytool.NewDeleteFileTool()
		listFilesTool, _ := mytool.NewListFilesTool()
		writeFileTool, _ := mytool.NewWriteFileTool()
		readFileTool, _ := mytool.NewReadFileTool()
		allTools = append(allTools, deleteFileTool, listFilesTool, writeFileTool, readFileTool)

		// 创建带持久化的Agent
		currentAgent := agent.NewCoderAgentWithStorage(context.Background(), newCm, allTools, session.SystemPrompt, session.WorkDir, dbStore, session.ID)
		sessions[session.ID] = currentAgent

		log.Printf("Loaded session %s from database", session.ID)
	}
}

func main() {
	ctx := context.Background()

	// 加载.env文件
	_ = godotenv.Load()

	// 初始化数据库存储
	var err error
	dbStore, err = storage.NewStorage("data/openagent.db")
	if err != nil {
		log.Fatalf("Failed to initialize database: %v", err)
	}
	defer dbStore.Close()

	// 加载现有会话
	loadExistingSessions()

	// --- 初始化 Agent ---
	allTools := runMCPClient(ctx)
	deleteFileTool, err := mytool.NewDeleteFileTool()
	if err != nil {
		log.Fatalf("初始化删除文件工具失败: %v", err)
	}
	listFilesTool, err := mytool.NewListFilesTool()
	if err != nil {
		log.Fatalf("初始化列出文件工具失败: %v", err)
	}
	writeFileTool, err := mytool.NewWriteFileTool()
	if err != nil {
		log.Fatalf("初始化写入文件工具失败: %v", err)
	}
	readFileTool, err := mytool.NewReadFileTool()
	if err != nil {
		log.Fatalf("初始化读取文件工具失败: %v", err)
	}
	allTools = append(allTools, deleteFileTool, listFilesTool, writeFileTool, readFileTool)

	apiKey := os.Getenv("OPENAI_API_KEY")
	modelName := os.Getenv("OPENAI_MODEL_NAME")
	baseURL := os.Getenv("OPENAI_BASE_URL")
	if apiKey == "" || modelName == "" {
		log.Fatal("请设置OPENAI_API_KEY和OPENAI_MODEL_NAME环境变量")
	}

	r := gin.Default()

	// 提供静态文件服务
	r.Static("/static", "./web/static")

	// 提供主页
	r.GET("/", func(c *gin.Context) {
		c.File("./web/index.html")
	})

	// 获取所有会话
	r.GET("/sessions", func(c *gin.Context) {
		storedSessions, err := dbStore.GetAllSessions()
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to get sessions"})
			return
		}
		c.JSON(http.StatusOK, storedSessions)
	})

	// 获取会话历史
	r.GET("/chat/history", func(c *gin.Context) {
		sessionID := c.Query("session_id")
		if sessionID == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "session_id is required"})
			return
		}
		history := dbStore.GetHistory(sessionID)
		c.JSON(http.StatusOK, history)
	})

	// 更新会话标题
	r.PUT("/sessions/:id/title", func(c *gin.Context) {
		sessionID := c.Param("id")
		var req struct {
			Title string `json:"title"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
			return
		}
		if err := dbStore.UpdateSession(sessionID, req.Title); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update session"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"message": "session updated"})
	})

	// 删除会话
	r.DELETE("/sessions/:id", func(c *gin.Context) {
		sessionID := c.Param("id")

		mu.Lock()
		agent, exists := sessions[sessionID]
		if exists {
			// 获取工作目录路径
			workDir := agent.GetWorkDir()
			// 从内存中删除会话
			delete(sessions, sessionID)
			mu.Unlock()

			// 删除工作目录
			if workDir != "" {
				if err := os.RemoveAll(workDir); err != nil {
					log.Printf("Failed to remove work directory %s: %v", workDir, err)
					// 不影响数据库删除，继续执行
				} else {
					log.Printf("Successfully removed work directory: %s", workDir)
				}
			}
		} else {
			mu.Unlock()
		}

		if err := dbStore.DeleteSession(sessionID); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to delete session from database"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"message": "session deleted successfully"})
	})

	// 获取数据库统计信息
	r.GET("/stats", func(c *gin.Context) {
		stats, err := dbStore.GetDBStats()
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to get stats"})
			return
		}
		c.JSON(http.StatusOK, stats)
	})

	// 列出文件
	r.GET("/files/list", func(c *gin.Context) {
		sessionID := c.Query("session_id")
		if sessionID == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "session_id is required"})
			return
		}

		// 获取会话的工作目录
		mu.Lock()
		agent, exists := sessions[sessionID]
		mu.Unlock()

		if !exists {
			c.JSON(http.StatusNotFound, gin.H{"error": "session not found"})
			return
		}

		// 获取工作目录
		workDir := agent.GetWorkDir()

		// 扫描目录并构建文件树
		files, err := scanDirectory(workDir, workDir)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to scan directory"})
			return
		}

		c.JSON(http.StatusOK, files)
	})

	// 读取文件
	r.GET("/files/read", func(c *gin.Context) {
		sessionID := c.Query("session_id")
		path := c.Query("path")

		if sessionID == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "session_id is required"})
			return
		}
		if path == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "path is required"})
			return
		}

		// 获取会话的工作目录
		mu.Lock()
		agent, exists := sessions[sessionID]
		mu.Unlock()

		if !exists {
			c.JSON(http.StatusNotFound, gin.H{"error": "session not found"})
			return
		}

		// 构建完整路径
		workDir := agent.GetWorkDir()
		fullPath := filepath.Join(workDir, path)

		// 安全检查：确保文件在工作目录内
		if !strings.HasPrefix(fullPath, workDir) {
			c.JSON(http.StatusForbidden, gin.H{"error": "access denied"})
			return
		}

		// 读取文件
		content, err := os.ReadFile(fullPath)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error()})
			return
		}

		c.JSON(http.StatusOK, gin.H{
			"success": true,
			"content": string(content),
		})
	})

	// WebSocket端点用于实时预览
	r.GET("/ws", handleWebSocket)

	// 为workspace文件提供HTTP访问路由
	r.GET("/workspace/:session_id/*filepath", func(c *gin.Context) {
		sessionID := c.Param("session_id")
		filePath := c.Param("filepath")

		// 移除路径前导的斜杠
		if len(filePath) > 0 && filePath[0] == '/' {
			filePath = filePath[1:]
		}

		// 如果路径为空，默认访问index.html
		if filePath == "" {
			filePath = "index.html"
		}

		// 获取会话的工作目录
		mu.Lock()
		agent, exists := sessions[sessionID]
		mu.Unlock()

		if !exists {
			c.JSON(http.StatusNotFound, gin.H{"error": "session not found"})
			return
		}

		// 构建完整路径
		workDir := agent.GetWorkDir()
		fullPath := filepath.Join(workDir, filePath)

		// 安全检查：确保文件在工作目录内
		if !strings.HasPrefix(fullPath, workDir) {
			c.JSON(http.StatusForbidden, gin.H{"error": "access denied"})
			return
		}

		// 检查文件是否存在
		if _, err := os.Stat(fullPath); os.IsNotExist(err) {
			c.JSON(http.StatusNotFound, gin.H{"error": "file not found"})
			return
		}

		// 根据文件类型设置Content-Type
		ext := strings.ToLower(filepath.Ext(filePath))
		switch ext {
		case ".html":
			c.Header("Content-Type", "text/html; charset=utf-8")
		case ".css":
			c.Header("Content-Type", "text/css; charset=utf-8")
		case ".js":
			c.Header("Content-Type", "application/javascript; charset=utf-8")
		case ".json":
			c.Header("Content-Type", "application/json; charset=utf-8")
		case ".png":
			c.Header("Content-Type", "image/png")
		case ".jpg", ".jpeg":
			c.Header("Content-Type", "image/jpeg")
		case ".gif":
			c.Header("Content-Type", "image/gif")
		case ".svg":
			c.Header("Content-Type", "image/svg+xml")
		default:
			c.Header("Content-Type", "application/octet-stream")
		}

		// 提供文件
		c.File(fullPath)
	})

	// 为HEAD请求提供支持
	r.HEAD("/workspace/:session_id/*filepath", func(c *gin.Context) {
		sessionID := c.Param("session_id")
		filePath := c.Param("filepath")

		// 移除路径前导的斜杠
		if len(filePath) > 0 && filePath[0] == '/' {
			filePath = filePath[1:]
		}

		// 如果路径为空，默认访问index.html
		if filePath == "" {
			filePath = "index.html"
		}

		// 获取会话的工作目录
		mu.Lock()
		agent, exists := sessions[sessionID]
		mu.Unlock()

		if !exists {
			c.JSON(http.StatusNotFound, gin.H{"error": "session not found"})
			return
		}

		// 构建完整路径
		workDir := agent.GetWorkDir()
		fullPath := filepath.Join(workDir, filePath)

		// 安全检查：确保文件在工作目录内
		if !strings.HasPrefix(fullPath, workDir) {
			c.JSON(http.StatusForbidden, gin.H{"error": "access denied"})
			return
		}

		// 检查文件是否存在
		if _, err := os.Stat(fullPath); os.IsNotExist(err) {
			c.JSON(http.StatusNotFound, gin.H{"error": "file not found"})
			return
		}

		// 根据文件类型设置Content-Type
		ext := strings.ToLower(filepath.Ext(filePath))
		switch ext {
		case ".html":
			c.Header("Content-Type", "text/html; charset=utf-8")
		case ".css":
			c.Header("Content-Type", "text/css; charset=utf-8")
		case ".js":
			c.Header("Content-Type", "application/javascript; charset=utf-8")
		case ".json":
			c.Header("Content-Type", "application/json; charset=utf-8")
		case ".png":
			c.Header("Content-Type", "image/png")
		case ".jpg", ".jpeg":
			c.Header("Content-Type", "image/jpeg")
		case ".gif":
			c.Header("Content-Type", "image/gif")
		case ".svg":
			c.Header("Content-Type", "image/svg+xml")
		default:
			c.Header("Content-Type", "application/octet-stream")
		}

		// 提供文件
		c.File(fullPath)
	})

	// 处理聊天请求
	r.POST("/chat", func(c *gin.Context) {
		var userInput struct {
			Content   string `json:"content"`
			SessionID string `json:"session_id"`
		}
		if err := c.ShouldBindJSON(&userInput); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
			return
		}

		mu.Lock()
		currentAgent, ok := sessions[userInput.SessionID]
		if !ok {
			// 在创建新模型之前，我们需要重新创建 ChatModel 实例
			// 因为原始的 cm 可能已经被某个会话使用和修改
			var temp float32 = 0.7
			newCm, err := openai.NewChatModel(ctx, &openai.ChatModelConfig{
				APIKey:      apiKey,
				BaseURL:     baseURL,
				Model:       modelName,
				Temperature: &temp,
			})
			if err != nil {
				log.Printf("为新会话创建ChatModel失败: %v", err)
				mu.Unlock()
				c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create new session"})
				return
			}
			userInput.SessionID = uuid.New().String()

			// 为新会话创建工作目录
			workDir := filepath.Join("workspace", userInput.SessionID)
			if err := os.MkdirAll(workDir, 0755); err != nil {
				log.Printf("为新会话创建工作目录失败: %v", err)
				mu.Unlock()
				c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create new session workspace"})
				return
			}

			// 为新会话创建工具副本
			// sessionTools := make([]tool.BaseTool, len(allTools))
			// copy(sessionTools, allTools)

			// 创建会话标题（使用用户输入的前20个字符）
			title := userInput.Content
			if len(title) > 20 {
				title = title[:20] + "..."
			}
			if strings.TrimSpace(title) == "" {
				title = "New Chat"
			}

			// 保存会话到数据库
			if err := dbStore.CreateSession(userInput.SessionID, workDir, baseSystemPrompt, title); err != nil {
				log.Printf("Failed to save session to database: %v", err)
				mu.Unlock()
				c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create session"})
				return
			}

			currentAgent = agent.NewCoderAgentWithStorage(ctx, newCm, allTools, baseSystemPrompt, workDir, dbStore, userInput.SessionID)
			sessions[userInput.SessionID] = currentAgent
		}
		mu.Unlock()

		// 设置SSE头
		c.Header("Content-Type", "text/event-stream")
		c.Header("Cache-Control", "no-cache")
		c.Header("Connection", "keep-alive")
		c.Header("Access-Control-Allow-Origin", "*")

		// 流式响应
		c.Stream(func(w io.Writer) bool {
			// 获取流式输出
			msgs, err := currentAgent.StreamRun(ctx, userInput.Content)
			if err != nil {
				log.Printf("请求失败: %v", err)
				// 发送错误事件
				c.SSEvent("error", gin.H{"error": err.Error()})
				return false // 关闭流
			}

			isFirstMessage := true
			// 循环读取流
			for msg := range msgs {
				// 将消息序列化为JSON
				msgJSON, err := json.Marshal(msg)
				if err != nil {
					log.Printf("序列化消息失败: %v", err)
					continue
				}

				eventData := gin.H{"data": string(msgJSON)}
				if isFirstMessage {
					eventData["session_id"] = userInput.SessionID
					isFirstMessage = false
				}

				// 发送SSE数据
				c.SSEvent("message", eventData)
				// 推送数据到客户端
				c.Writer.Flush()
			}
			// 流结束
			c.SSEvent("message", gin.H{"is_end": true})
			c.Writer.Flush()
			return false // 表示流结束
		})
	})

	fmt.Println("服务已启动，请访问 http://localhost:8081")
	if err := r.Run(":8081"); err != nil {
		log.Fatalf("启动Gin服务失败: %v", err)
	}
}
