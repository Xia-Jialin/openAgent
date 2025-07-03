document.addEventListener("DOMContentLoaded", function() {
    const messageInput = document.getElementById("message-input");
    const sendButton = document.getElementById("send-button");
    const chatBox = document.getElementById("chat-box");
    let eventSource;

    function sendMessage() {
        const content = messageInput.value.trim();
        if (content === "") {
            return;
        }

        addMessage("user", content);
        messageInput.value = "";
        
        // 如果已存在EventSource，先关闭
        if (eventSource) {
            eventSource.close();
        }

        // 使用POST请求来启动SSE连接
        fetch('/chat', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ content: content }),
        }).then(response => {
            // 这里我们不处理response的body，因为真正的消息会通过SSE过来
            // 但我们需要一个新的EventSource来接收消息
            // 注意：这种模式有点非标准，通常GET请求用于启动SSE
            // 但为了传递用户输入，我们用POST来"触发"流
            // 真正的流数据需要一个新的连接来接收
            // 一个更标准的做法是POST请求本身返回流。让我们坚持之前的fetch流实现。
            // 不，我将坚持使用EventSource，但需要调整后端的实现。
            
            // 让我们调整前端逻辑来匹配新的设想
            // 用户点击发送后，我们将启动一个新的EventSource
            // 为了传递消息，我们将其作为URL参数
            
            // 放弃fetch，直接使用EventSource并带上参数
            // 这要求后端/chat是GET请求
            // 让我们改回fetch流读取，因为这更符合POST语义
             handleStreamResponse(content);

        }).catch(error => {
            console.error('Error starting chat session:', error);
            addMessage("system", "Error starting chat session.");
        });
    }
    
    async function handleStreamResponse(content) {
        try {
            const response = await fetch('/chat', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ content: content }),
            });

            if (!response.body) {
                addMessage("system", "Streaming not supported or failed.");
                return;
            }
            
            const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
            
            let assistantMessageElement = null;
            let buffer = '';

            while (true) {
                const { value, done } = await reader.read();
                
                if (done) {
                    console.log("Stream finished.");
                    break;
                }

                buffer += value;
                
                let boundary;
                while ((boundary = buffer.indexOf('\n\n')) >= 0) {
                    const chunk = buffer.substring(0, boundary);
                    buffer = buffer.substring(boundary + 2);

                    const lines = chunk.split('\n');
                    for (const line of lines) {
                         if (line.startsWith('data:')) {
                            const data = line.substring(5).trim();
                            if (!data) continue;
                            
                            try {
                                const msg = JSON.parse(data);

                                if (msg.is_end) {
                                    assistantMessageElement = null;
                                    continue; 
                                }

                                if (msg.tool_calls && msg.tool_calls.length > 0) {
                                    const toolCallContent = msg.tool_calls.map(tc => 
                                        `Tool Call: ${tc.function.name}\nArguments: ${tc.function.arguments}`
                                    ).join('\n');
                                    addMessage("assistant", toolCallContent, true);
                                    continue;
                                }

                                if (msg.content) {
                                    if (!assistantMessageElement) {
                                        assistantMessageElement = addMessage("assistant", "");
                                    }
                                    const contentDiv = assistantMessageElement.querySelector('.content');
                                    contentDiv.textContent += msg.content;
                                    chatBox.scrollTop = chatBox.scrollHeight;
                                }
                            } catch (e) {
                                console.error("Error parsing JSON from stream:", e, "data:", data);
                            }
                        }
                    }
                }
            }
        } catch (error) {
            console.error('Error during fetch stream:', error);
            addMessage("system", "Connection to agent lost.");
        }
    }

    function addMessage(role, content, isToolCall = false) {
        const messageElement = createMessageElement(role, content, isToolCall);
        chatBox.appendChild(messageElement);
        chatBox.scrollTop = chatBox.scrollHeight;
        return messageElement;
    }

    function createMessageElement(role, content, isToolCall = false) {
        const messageElement = document.createElement("div");
        messageElement.classList.add("message", role);

        const roleElement = document.createElement("div");
        roleElement.classList.add("role");
        roleElement.textContent = role;
        messageElement.appendChild(roleElement);

        const contentElement = document.createElement("div");
        if (isToolCall) {
            contentElement.classList.add("tool-call");
        } else {
            contentElement.classList.add("content");
        }
        contentElement.textContent = content;
        messageElement.appendChild(contentElement);

        return messageElement;
    }

    sendButton.addEventListener("click", sendMessage);
    messageInput.addEventListener("keypress", function(event) {
        if (event.key === "Enter") {
            sendMessage();
        }
    });
    
    addMessage("system", "Welcome to OpenAgent. Type your message and press Enter.");
}); 