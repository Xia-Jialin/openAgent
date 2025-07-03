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
	GetHistory() []*schema.Message
}

type coderAgent struct {
	model   model.ToolCallingChatModel
	tools   []tool.BaseTool
	history []*schema.Message
}

func NewCoderAgent(ctx context.Context, model model.ToolCallingChatModel, tools []tool.BaseTool, systemPrompt string) *coderAgent {
	toolsInfo := make([]*schema.ToolInfo, len(tools))
	for i, tool := range tools {
		toolInfo, err := tool.Info(ctx)
		if err != nil {
			log.Fatalf("Failed to get tool info: %v", err)
		}
		toolsInfo[i] = toolInfo
	}
	model.WithTools(toolsInfo)
	systemMessage := &schema.Message{
		Role:    schema.System,
		Content: systemPrompt,
	}
	return &coderAgent{model: model, tools: tools, history: []*schema.Message{systemMessage}}
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
	a.history = append(a.history, msg)
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
		defer close(ch)
		var assistantMessage *schema.Message
		for {
			msgPart, err := stream.Recv()
			if err != nil {
				if assistantMessage != nil {
					a.history = append(a.history, assistantMessage)
				}
				return
			}

			if assistantMessage == nil {
				assistantMessage = &schema.Message{
					Role: msgPart.Role,
				}
			}
			assistantMessage.Content += msgPart.Content
			if len(msgPart.ToolCalls) > 0 {
				assistantMessage.ToolCalls = append(assistantMessage.ToolCalls, msgPart.ToolCalls...)
			}
			ch <- msgPart
		}
	}()
	return ch, nil
}

func (a *coderAgent) GetHistory() []*schema.Message {
	return a.history
}
