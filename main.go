package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"sync"

	"github.com/cloudwego/eino-ext/components/model/openai"
	"github.com/cloudwego/eino/components/tool"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/joho/godotenv"

	"openAgent/agent"
	mytool "openAgent/tool"

	toolMcp "github.com/cloudwego/eino-ext/components/tool/mcp"
	"github.com/mark3labs/mcp-go/client"
	"github.com/mark3labs/mcp-go/client/transport"
	"github.com/mark3labs/mcp-go/mcp"
)

var (
	sessions = make(map[string]agent.Agent)
	mu       sync.Mutex
)

const systemPrompt = `\nYou are OpenManus, an all-capable AI assistant, aimed at solving any task presented by the user. You have various tools at your disposal that you can call upon to efficiently complete complex requests. Whether it's programming, information retrieval, file processing, or web browsing, you can handle it all.\n`

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

func main() {
	ctx := context.Background()

	// 加载.env文件
	_ = godotenv.Load()

	// --- 初始化 Agent ---
	tools := runMCPClient(ctx)
	deleteFileTool, err := mytool.NewDeleteFileTool()
	if err != nil {
		log.Fatalf("初始化删除文件工具失败: %v", err)
	}
	tools = append(tools, deleteFileTool)

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
		mu.Lock()
		defer mu.Unlock()
		sessionIDs := make([]string, 0, len(sessions))
		for id := range sessions {
			sessionIDs = append(sessionIDs, id)
		}
		c.JSON(http.StatusOK, sessionIDs)
	})

	// 获取会话历史
	r.GET("/chat/history", func(c *gin.Context) {
		sessionID := c.Query("session_id")
		if sessionID == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "session_id is required"})
			return
		}
		mu.Lock()
		defer mu.Unlock()
		currentAgent, ok := sessions[sessionID]
		if !ok {
			c.JSON(http.StatusNotFound, gin.H{"error": "session not found"})
			return
		}
		history := currentAgent.GetHistory()
		c.JSON(http.StatusOK, history)
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
			currentAgent = agent.NewCoderAgent(ctx, newCm, tools, systemPrompt)
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

	fmt.Println("服务已启动，请访问 http://localhost:8080")
	if err := r.Run(":8080"); err != nil {
		log.Fatalf("启动Gin服务失败: %v", err)
	}
}
