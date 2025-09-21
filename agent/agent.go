package agent

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"sync"

	"github.com/cloudwego/eino/components/model"
	"github.com/cloudwego/eino/components/tool"
	"github.com/cloudwego/eino/schema"
	"openAgent/storage"
)

type Agent interface {
	Run(ctx context.Context, input string) (*schema.Message, error)
	//流式输出，返回通道，通道中是消息，仅输出，不写入
	StreamRun(ctx context.Context, input string) (<-chan *schema.Message, error)
	GetHistory() []*schema.Message
	GetWorkDir() string
}

type contextKey string

const WorkDirKey contextKey = "workDir"

type coderAgent struct {
	model      model.ChatModel
	tools      []tool.BaseTool
	history    []*schema.Message
	workDir    string
	toolMap    map[string]tool.InvokableTool
	dbStore    *storage.Storage
	sessionID  string
	mu         sync.Mutex
}

func NewCoderAgent(ctx context.Context, model model.ChatModel, tools []tool.BaseTool, systemPrompt string, workDir string) *coderAgent {
	return NewCoderAgentWithStorage(ctx, model, tools, systemPrompt, workDir, nil, "")
}

func NewCoderAgentWithStorage(ctx context.Context, model model.ChatModel, tools []tool.BaseTool, systemPrompt string, workDir string, dbStore *storage.Storage, sessionID string) *coderAgent {
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

	var history []*schema.Message
	systemMessage := &schema.Message{
		Role:    schema.System,
		Content: systemPrompt,
	}
	history = append(history, systemMessage)

	// 如果有数据库存储，加载历史消息
	if dbStore != nil && sessionID != "" {
		loadedMessages := dbStore.GetHistory(sessionID)
		if len(loadedMessages) > 0 {
			history = loadedMessages
		}
	}

	return &coderAgent{
		model:     model,
		tools:     tools,
		history:   history,
		workDir:   workDir,
		toolMap:   toolMap,
		dbStore:   dbStore,
		sessionID: sessionID,
	}
}

func (a *coderAgent) Run(ctx context.Context, input string) (*schema.Message, error) {
	log.Println("Run", input)
	a.mu.Lock()
	defer a.mu.Unlock()

	msg := &schema.Message{
		Role:    schema.User,
		Content: input,
	}
	a.history = append(a.history, msg)

	// 保存用户消息到数据库
	if a.dbStore != nil && a.sessionID != "" {
		if err := a.dbStore.SaveMessage(a.sessionID, msg); err != nil {
			log.Printf("Failed to save user message: %v", err)
		}
	}

	ctxWithWorkDir := context.WithValue(ctx, WorkDirKey, a.workDir)

	for {
		// Validate message history before sending to API
		if err := a.validateMessageHistory(); err != nil {
			return nil, fmt.Errorf("message validation failed: %w", err)
		}

		
		msg, err := a.model.Generate(ctxWithWorkDir, a.history)
		if err != nil {
			return nil, err
		}
		a.history = append(a.history, msg)

		// 保存助手消息到数据库
		if a.dbStore != nil && a.sessionID != "" {
			if err := a.dbStore.SaveMessage(a.sessionID, msg); err != nil {
				log.Printf("Failed to save assistant message: %v", err)
			}
		}

		if len(msg.ToolCalls) == 0 {
			return msg, nil
		}
		var toolCalls []*schema.ToolCall
		for i := range msg.ToolCalls {
			toolCalls = append(toolCalls, &msg.ToolCalls[i])
		}

		toolResults := a.executeToolCalls(ctxWithWorkDir, toolCalls)
		a.history = append(a.history, toolResults...)

		// 保存工具结果到数据库
		if a.dbStore != nil && a.sessionID != "" {
			for _, toolResult := range toolResults {
				if err := a.dbStore.SaveMessage(a.sessionID, toolResult); err != nil {
					log.Printf("Failed to save tool result: %v", err)
				}
			}
		}
	}
}

func (a *coderAgent) StreamRun(ctx context.Context, input string) (<-chan *schema.Message, error) {
	a.mu.Lock()
	msg := &schema.Message{
		Role:    schema.User,
		Content: input,
	}
	a.history = append(a.history, msg)

	// 保存用户消息到数据库
	if a.dbStore != nil && a.sessionID != "" {
		if err := a.dbStore.SaveMessage(a.sessionID, msg); err != nil {
			log.Printf("Failed to save user message: %v", err)
		}
	}
	a.mu.Unlock()

	ch := make(chan *schema.Message)
	ctxWithWorkDir := context.WithValue(ctx, WorkDirKey, a.workDir)

	go func() {
		defer close(ch)
		for {
			// Validate message history before sending to API
			a.mu.Lock()
			if err := a.validateMessageHistory(); err != nil {
				log.Printf("message validation failed: %v", err)
				a.mu.Unlock()
				return
			}

						a.mu.Unlock()

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
						a.mu.Lock()
						a.history = append(a.history, assistantMessage)

						// 保存助手消息到数据库
						if a.dbStore != nil && a.sessionID != "" {
							if err := a.dbStore.SaveMessage(a.sessionID, assistantMessage); err != nil {
								log.Printf("Failed to save assistant message: %v", err)
							}
						}

						hasToolCall = len(assistantMessage.ToolCalls) > 0
						a.mu.Unlock()
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

			a.mu.Lock()
			a.history = append(a.history, toolResults...)

			// 保存工具结果到数据库
			if a.dbStore != nil && a.sessionID != "" {
				for _, toolResult := range toolResults {
					if err := a.dbStore.SaveMessage(a.sessionID, toolResult); err != nil {
						log.Printf("Failed to save tool result: %v", err)
					}
				}
			}
			a.mu.Unlock()

			// Send tool results to frontend
			fmt.Printf("Sending %d tool results to frontend\n", len(toolResults))
			for _, toolResult := range toolResults {
				// Safe string truncation for debugging
				contentPreview := toolResult.Content
				if len(contentPreview) > 100 {
					contentPreview = contentPreview[:100] + "..."
				}
				fmt.Printf("Sending tool result: role=%s, content=%s\n", toolResult.Role, contentPreview)
				ch <- toolResult
			}
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

func (a *coderAgent) GetWorkDir() string {
	return a.workDir
}

// validateMessageHistory ensures that tool messages are properly preceded by assistant messages with tool calls
func (a *coderAgent) validateMessageHistory() error {
	// First, validate that no message has empty content
	for i, msg := range a.history {
		if msg.Content == "" {
			log.Printf("Warning: Message %d has empty content, fixing it", i)
			msg.Content = "[No content]"
		}
	}

	toolCallIDs := make(map[string]bool)

	// First pass: collect all tool call IDs from assistant messages
	for _, msg := range a.history {
		if msg.Role == schema.Assistant && len(msg.ToolCalls) > 0 {
			for _, tc := range msg.ToolCalls {
				toolCallIDs[tc.ID] = true
			}
		}
	}

	// Second pass: validate tool messages
	for _, msg := range a.history {
		if msg.Role == schema.Tool {
			if msg.ToolCallID == "" {
				return fmt.Errorf("tool message missing tool_call_id")
			}
			if !toolCallIDs[msg.ToolCallID] {
				return fmt.Errorf("tool message with tool_call_id '%s' has no corresponding assistant message with tool calls", msg.ToolCallID)
			}
		}
	}

	return nil
}
