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

	"github.com/cloudwego/eino-ext/components/model/openai"
	"github.com/cloudwego/eino/components/tool"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
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
)

const baseSystemPrompt = `
You are OpenManus, an all-capable AI assistant, aimed at solving any task presented by the user. You have various tools at your disposal that you can call upon to efficiently complete complex requests. Whether it's programming, information retrieval, file processing, or web browsing, you can handle it all.

You have a dedicated workspace. When using file-related tools (such as list_files, write_file, read_file, delete_file), all file paths should be relative to your workspace. Do not use absolute paths.
`

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
		delete(sessions, sessionID)
		mu.Unlock()

		if err := dbStore.DeleteSession(sessionID); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to delete session"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"message": "session deleted"})
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
