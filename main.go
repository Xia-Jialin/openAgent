package main

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"strings"

	"github.com/cloudwego/eino-ext/components/model/openai"
	"github.com/cloudwego/eino/components/model"
	"github.com/cloudwego/eino/components/tool"
	"github.com/cloudwego/eino/compose"
	"github.com/cloudwego/eino/schema"
	"github.com/joho/godotenv"

	toolMcp "github.com/cloudwego/eino-ext/components/tool/mcp"
	"github.com/mark3labs/mcp-go/client"
	"github.com/mark3labs/mcp-go/client/transport"
	"github.com/mark3labs/mcp-go/mcp"
	mytool "openAgent/tool"
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

type state struct {
	history []*schema.Message
}

func newAgent(ctx context.Context, model model.ToolCallingChatModel, tools []tool.BaseTool) compose.Runnable[[]*schema.Message, []*schema.Message] {
	// 获取工具信息
	toolsInfo := getToolsInfo(ctx, tools)

	// 为模型绑定工具
	model, err := model.WithTools(toolsInfo)
	if err != nil {
		log.Fatalf("初始化模型失败: %v", err)
	}

	// 初始化工具节点
	toolsNode := initToolsNode(ctx, tools)

	// 创建图实例
	g := compose.NewGraph[[]*schema.Message, []*schema.Message](compose.WithGenLocalState(func(ctx context.Context) *state {
		return &state{}
	}))

	// 添加节点和边
	addNodesAndEdges(g, model, toolsNode)

	// 编译图
	a, err := g.Compile(ctx)
	if err != nil {
		log.Fatalf("编译失败: %v", err)
	}

	return a
}

// 获取工具信息
func getToolsInfo(ctx context.Context, tools []tool.BaseTool) []*schema.ToolInfo {
	var toolsInfo []*schema.ToolInfo
	for _, t := range tools {
		info, err := t.Info(ctx)
		if err != nil {
			log.Printf("GetToolInfo failed, err=%v", err)
			continue
		}
		toolsInfo = append(toolsInfo, info)
	}
	return toolsInfo
}

// 初始化工具节点
func initToolsNode(ctx context.Context, tools []tool.BaseTool) *compose.ToolsNode {
	toolsNode, err := compose.NewToolNode(ctx, &compose.ToolsNodeConfig{
		Tools: tools,
	})
	if err != nil {
		log.Fatalf("初始化工具节点失败: %v", err)
	}
	return toolsNode
}

// 添加节点和边
func addNodesAndEdges(g *compose.Graph[[]*schema.Message, []*schema.Message], model model.ToolCallingChatModel, toolsNode *compose.ToolsNode) {
	// 定义处理器
	preHandler := func(ctx context.Context, in *schema.Message, state *state) (*schema.Message, error) {
		state.history = append(state.history, in)
		return in, nil
	}
	postHandler := func(ctx context.Context, out []*schema.Message, state *state) ([]*schema.Message, error) {
		state.history = append(state.history, out...)
		return state.history, nil
	}

	// 添加模型节点
	g.AddChatModelNode("model_node", model, compose.WithStatePreHandler(postHandler))

	// 添加工具节点
	g.AddToolsNode("tools_node", toolsNode, compose.WithStatePreHandler(preHandler))

	// 添加Lambda节点
	lambda := compose.InvokableLambda(func(ctx context.Context, input *schema.Message) (output []*schema.Message, err error) {
		return []*schema.Message{input}, nil
	})
	g.AddLambdaNode("lambda_node", lambda, compose.WithStatePostHandler(postHandler))

	// 添加分支条件
	condition := func(ctx context.Context, in *schema.Message) (string, error) {
		if in.ToolCalls != nil {
			return "tools_node", nil
		}
		return "lambda_node", nil
	}
	endNodes := map[string]bool{"tools_node": true, "lambda_node": true}
	branch := compose.NewGraphBranch(condition, endNodes)

	// 添加边
	g.AddEdge(compose.START, "model_node")
	g.AddEdge("tools_node", "model_node")
	g.AddBranch("model_node", branch)
	g.AddEdge("lambda_node", compose.END)
}

func main() {
	ctx := context.Background()

	// 加载.env文件
	_ = godotenv.Load()

	tools := runMCPClient(ctx)
	deleteFileTool, err := mytool.NewDeleteFileTool()
	if err != nil {
		log.Fatalf("初始化删除文件工具失败: %v", err)
	}
	tools = append(tools, deleteFileTool)

	// 获取工具信息
	var toolsInfo []*schema.ToolInfo
	for _, t := range tools {

		info, err := t.Info(ctx)
		if err != nil {
			log.Printf("GetToolInfo failed, err=%v", err)
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

	agent := newAgent(ctx, withTools, tools)

	for {
		fmt.Print("你: ")
		input, _ := reader.ReadString('\n')
		input = strings.TrimSpace(input) // 去除换行符和可能的空格

		if input == "exit" {
			fmt.Println("再见！")
			return
		}

		if input == "" {
			continue
		}

		history = append(history, &schema.Message{Role: schema.User, Content: input})

		msgs, err := agent.Invoke(ctx, history)
		if err != nil {
			log.Printf("请求失败: %v", err)
			// 如果请求失败，可以选择是否将错误信息也加入历史，或者直接继续下一次对话
			// 这里我们选择不将错误加入历史，直接继续
			// 也可以考虑从history中移除最后一条用户消息，避免影响后续对话
			if len(history) > 0 {
				history = history[:len(history)-1]
			}
			continue
		}

		fmt.Printf("%+v\n", msgs)
		// 打印并记录模型的回复
		if len(msgs) > 0 {
			// 假设agent.Invoke返回的是一个包含最新回复的Message列表
			// 通常我们关心的是最后一个Message，即AI的回复
			aiResponse := msgs[len(msgs)-1]
			fmt.Printf("AI: %s\n", aiResponse.Content)
			history = append(history, aiResponse) // 将AI的回复也加入历史
		} else {
			fmt.Println("AI: (无回复)")
		}
	}
}
