package agent

import (
	"context"
	"log"

	"github.com/cloudwego/eino/components/model"
	"github.com/cloudwego/eino/components/tool"
	"github.com/cloudwego/eino/schema"
)

type Agent interface {
	Run(ctx context.Context, input string) (*schema.Message, error)
	//流式输出，返回通道，通道中是消息，仅输出，不写入
	StreamRun(ctx context.Context, input string) (<-chan *schema.Message, error)
}

type coderAgent struct {
	systemPromptMessage schema.Message
	model               model.ToolCallingChatModel
	tools               []tool.BaseTool
	history             []*schema.Message
}

func NewCoderAgent(ctx context.Context, model model.ToolCallingChatModel, tools []tool.BaseTool) *coderAgent {
	toolsInfo := make([]*schema.ToolInfo, len(tools))
	for i, tool := range tools {
		toolInfo, err := tool.Info(ctx)
		if err != nil {
			log.Fatalf("Failed to get tool info: %v", err)
		}
		toolsInfo[i] = toolInfo
	}
	model.WithTools(toolsInfo)
	return &coderAgent{model: model, tools: tools}
}

func (a *coderAgent) Run(ctx context.Context, input string) (*schema.Message, error) {
	log.Println("Run", input)
	msg := &schema.Message{
		Role:    schema.User,
		Content: input,
	}
	a.history = append(a.history, msg)
	msg, err := a.model.Generate(ctx, a.history)
	if err != nil {
		return nil, err
	}
	// a.history = append(a.history, msg)
	// toolNode, err := compose.NewToolNode(ctx, &compose.ToolsNodeConfig{
	// 	Tools: a.tools,
	// })
	// if err != nil {
	// 	return nil, err
	// }
	// if len(msg.ToolCalls) > 0 {
	// 	toolResults, err := toolNode.Invoke(ctx, msg)
	// 	if err != nil {
	// 		return nil, err
	// 	}
	// 	msg = toolResults[0]
	// }
	// a.history = append(a.history, msg)
	return msg, nil
}

func (a *coderAgent) StreamRun(ctx context.Context, input string) (<-chan *schema.Message, error) {
	msg := &schema.Message{
		Role:    schema.User,
		Content: input,
	}
	a.history = append(a.history, msg)
	stream, err := a.model.Stream(ctx, a.history)
	if err != nil {
		return nil, err
	}
	ch := make(chan *schema.Message)
	go func() {
		for {
			msg, err := stream.Recv()
			if err != nil {
				close(ch)
				return
			}
			ch <- msg
		}
	}()
	return ch, nil
}