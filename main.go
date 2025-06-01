package main

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"

	"github.com/cloudwego/eino-ext/components/model/openai"
	"github.com/cloudwego/eino/components/tool"
	"github.com/cloudwego/eino/compose"
	"github.com/cloudwego/eino/schema"
	"github.com/joho/godotenv"

	toolMcp "github.com/cloudwego/eino-ext/components/tool/mcp"
	"github.com/mark3labs/mcp-go/client"
	"github.com/mark3labs/mcp-go/client/transport"
	"github.com/mark3labs/mcp-go/mcp"
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
func runMCPClient(ctx context.Context, serverName string) []tool.BaseTool {

	cfg, err := loadMCPConfig("mcp.json")
	if err != nil {
		log.Fatalf("读取mcp.json失败: %v", err)
	}
	fmt.Println(cfg)

	stdioTransport := transport.NewStdio(cfg.McpServers[serverName].Command, nil, cfg.McpServers[serverName].Args...)

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
	return tools
}

// 调用工具的处理逻辑，参数为*schema.Message，返回[]*schema.Message
func handleToolCalls(ctx context.Context, tools []tool.BaseTool, msg *schema.Message) ([]*schema.Message, error) {
	if msg.ToolCalls == nil {
		return nil, nil
	}
	toolsNode, err := compose.NewToolNode(ctx, &compose.ToolsNodeConfig{
		Tools: tools,
	})
	if err != nil {
		return nil, err
	}
	chain := compose.NewChain[*schema.Message, []*schema.Message]()
	chain.AppendToolsNode(toolsNode)
	a, err := chain.Compile(ctx)
	if err != nil {
		return nil, err
	}
	msgs, err := a.Invoke(ctx, msg)
	if err != nil {
		return nil, err
	}
	return msgs, nil
}

func main() {
	ctx := context.Background()

	// 加载.env文件
	_ = godotenv.Load()

	tools := runMCPClient(ctx, os.Args[2])

	// 获取工具信息
	var toolsInfo []*schema.ToolInfo
	for _, t := range tools {

		info, err := t.Info(ctx)
		if err != nil {
			fmt.Errorf("GetToolInfo failed, err=%v", err)
			continue
		}
		toolsInfo = append(toolsInfo, info)
	}

	apiKey := os.Getenv("OPENAI_API_KEY")
	model := os.Getenv("OPENAI_MODEL_NAME")
	baseURL := os.Getenv("OPENAI_BASE_URL")
	if apiKey == "" || model == "" {
		log.Fatal("请设置OPENAI_API_KEY和OPENAI_MODEL_NAME环境变量")
	}
	var temp float32 = 0.7
	cm, err := openai.NewChatModel(ctx, &openai.ChatModelConfig{
		APIKey:      apiKey,
		BaseURL:     baseURL,
		Model:       model,
		Temperature: &temp,
	})
	if err != nil {
		log.Fatalf("初始化OpenAI模型失败: %v", err)
	}

	// 为模型绑定工具
	withTools, err := cm.WithTools(toolsInfo)
	if err != nil {
		panic(err)
	}

	reader := bufio.NewReader(os.Stdin)
	fmt.Println("欢迎使用OpenAI聊天机器人，输入内容并回车即可开始对话，输入exit退出。\n如需体验MCP功能，请用命令：go run main.go mcp context7")
	var history []*schema.Message
	history = append(history, &schema.Message{Role: schema.System, Content: systemPrompt})
	fmt.Print("你: ")
	input, _ := reader.ReadString('\n')
	input = input[:len(input)-1]
	if input == "exit" {
		return
	}
	history = append(history, &schema.Message{Role: schema.User, Content: input})
	resp, err := withTools.Generate(ctx, history)
	if err != nil {
		log.Printf("请求失败: %v", err)
		return
	}

	history = append(history, resp)
	//检查是否调用了工具
	if resp.ToolCalls != nil {
		msgs, err := handleToolCalls(ctx, tools, resp)
		if err != nil {
			log.Printf("工具调用处理失败: %v", err)
			return
		}
		history = append(history, msgs...)
		fmt.Printf("%+v\n", history)
	}

	resp, err = withTools.Generate(ctx, history)
	if err != nil {
		log.Printf("请求失败: %v", err)
		return
	}
	history = append(history, resp)
	fmt.Printf("%+v\n", history)
	fmt.Printf("%+v\n", resp)
	fmt.Printf("AI: %s\n", resp.Content)
}
