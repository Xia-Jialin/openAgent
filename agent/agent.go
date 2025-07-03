package agent

import (
	"context"
	"encoding/json"
	"fmt"
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

type contextKey string

const WorkDirKey contextKey = "workDir"

type coderAgent struct {
	model   model.ChatModel
	tools   []tool.BaseTool
	history []*schema.Message
	workDir string
	toolMap map[string]tool.InvokableTool
}

func NewCoderAgent(ctx context.Context, model model.ChatModel, tools []tool.BaseTool, systemPrompt string, workDir string) *coderAgent {
	toolsInfo := make([]*schema.ToolInfo, len(tools))
	toolMap := make(map[string]tool.InvokableTool)
	for i, t := range tools {
		toolInfo, err := t.Info(ctx)
		if err != nil {
			log.Fatalf("Failed to get tool info: %v", err)
		}
		toolsInfo[i] = toolInfo
		if invokableTool, ok := t.(tool.InvokableTool); ok {
			toolMap[toolInfo.Name] = invokableTool
		}
	}
	model.BindTools(toolsInfo)
	systemMessage := &schema.Message{
		Role:    schema.System,
		Content: systemPrompt,
	}
	return &coderAgent{model: model, tools: tools, history: []*schema.Message{systemMessage}, workDir: workDir, toolMap: toolMap}
}

func (a *coderAgent) Run(ctx context.Context, input string) (*schema.Message, error) {
	log.Println("Run", input)
	msg := &schema.Message{
		Role:    schema.User,
		Content: input,
	}
	a.history = append(a.history, msg)
	ctxWithWorkDir := context.WithValue(ctx, WorkDirKey, a.workDir)

	for {
		msg, err := a.model.Generate(ctxWithWorkDir, a.history)
		if err != nil {
			return nil, err
		}
		a.history = append(a.history, msg)

		if len(msg.ToolCalls) == 0 {
			return msg, nil
		}
		var toolCalls []*schema.ToolCall
		for i := range msg.ToolCalls {
			toolCalls = append(toolCalls, &msg.ToolCalls[i])
		}

		toolResults := a.executeToolCalls(ctxWithWorkDir, toolCalls)
		a.history = append(a.history, toolResults...)
	}
}

func (a *coderAgent) StreamRun(ctx context.Context, input string) (<-chan *schema.Message, error) {
	msg := &schema.Message{
		Role:    schema.User,
		Content: input,
	}
	a.history = append(a.history, msg)
	ch := make(chan *schema.Message)
	ctxWithWorkDir := context.WithValue(ctx, WorkDirKey, a.workDir)

	go func() {
		defer close(ch)
		for {
			stream, err := a.model.Stream(ctxWithWorkDir, a.history)
			if err != nil {
				log.Printf("failed to stream: %v", err)
				return
			}

			var assistantMessage *schema.Message
			var hasToolCall bool
			for {
				msgPart, err := stream.Recv()
				if err != nil { // Stream ended
					if assistantMessage != nil {
						a.history = append(a.history, assistantMessage)
						hasToolCall = len(assistantMessage.ToolCalls) > 0
					}
					break // Exit inner loop to process tool calls
				}

				if assistantMessage == nil {
					assistantMessage = &schema.Message{Role: msgPart.Role}
				}
				assistantMessage.Content += msgPart.Content
				if len(msgPart.ToolCalls) > 0 {
					for _, part := range msgPart.ToolCalls {
						if part.Index == nil {
							continue // Should not happen, but as a safeguard
						}
						idx := *part.Index
						// Ensure the slice is large enough
						if idx >= len(assistantMessage.ToolCalls) {
							newCalls := make([]schema.ToolCall, idx+1)
							copy(newCalls, assistantMessage.ToolCalls)
							assistantMessage.ToolCalls = newCalls
						}

						// Merge the part
						existing := &assistantMessage.ToolCalls[idx]
						if existing.ID == "" {
							existing.ID = part.ID
						}
						if existing.Type == "" {
							existing.Type = part.Type
						}
						if existing.Function.Name == "" {
							existing.Function.Name = part.Function.Name
						}
						existing.Function.Arguments += part.Function.Arguments
					}
				}
				ch <- msgPart
			}

			if !hasToolCall {
				return // No more tool calls, we are done
			}
			var toolCalls []*schema.ToolCall
			for i := range assistantMessage.ToolCalls {
				toolCalls = append(toolCalls, &assistantMessage.ToolCalls[i])
			}

			toolResults := a.executeToolCalls(ctxWithWorkDir, toolCalls)
			a.history = append(a.history, toolResults...)
			// The loop will continue and call the model again with tool results
		}
	}()

	return ch, nil
}

func (a *coderAgent) executeToolCalls(ctx context.Context, toolCalls []*schema.ToolCall) []*schema.Message {
	var toolResultMsgs []*schema.Message
	for _, tc := range toolCalls {
		var content string
		tool, ok := a.toolMap[tc.Function.Name]
		if !ok {
			errorContent := map[string]interface{}{"success": false, "error": fmt.Sprintf("tool %s not found", tc.Function.Name)}
			jsonResult, _ := json.Marshal(errorContent)
			content = string(jsonResult)
		} else {
			// 如果模型没有提供参数，则默认为空JSON对象
			args := tc.Function.Arguments
			if args == "" {
				args = "{}"
			}
			result, err := tool.InvokableRun(ctx, args)
			if err != nil {
				errorContent := map[string]interface{}{"success": false, "error": fmt.Sprintf("tool %s execution failed: %v", tc.Function.Name, err)}
				jsonResult, _ := json.Marshal(errorContent)
				content = string(jsonResult)
			} else {
				content = result
			}
		}

		toolResultMsgs = append(toolResultMsgs, &schema.Message{
			Role:       schema.Tool,
			Content:    content,
			ToolCallID: tc.ID,
		})
	}
	return toolResultMsgs
}

func (a *coderAgent) GetHistory() []*schema.Message {
	return a.history
}
