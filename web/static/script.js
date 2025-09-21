document.addEventListener("DOMContentLoaded", function() {
    console.log("OpenAgent: DOM Content Loaded");

    const messageInput = document.getElementById("message-input");
    const sendButton = document.getElementById("send-button");
    const newChatButton = document.getElementById("new-chat-button");
    const chatBox = document.getElementById("chat-box");
    const sessionList = document.getElementById("session-list");

    console.log("OpenAgent: Elements found:", {
        messageInput: !!messageInput,
        sendButton: !!sendButton,
        newChatButton: !!newChatButton,
        chatBox: !!chatBox,
        sessionList: !!sessionList
    });

    let sessionId = null; // 用于存储会话ID
    let isNewSession = true; // 标记是否为新会话

    function startNewChat() {
        sessionId = null;
        isNewSession = true;
        chatBox.innerHTML = '';
        addMessage("system", "New chat started. Type your message and press Enter.");
        
        // 更新会话列表UI
        const currentlyActive = sessionList.querySelector('.active');
        if (currentlyActive) {
            currentlyActive.classList.remove('active');
        }

        // 移除临时的 "New Chat" 项（如果存在）
        const tempNewChatItem = sessionList.querySelector('.new-chat-temp');
        if (tempNewChatItem) {
            tempNewChatItem.remove();
        }

        // 添加一个临时的 "New Chat" 项
        const newChatLi = document.createElement('li');
        newChatLi.textContent = "New Chat";
        newChatLi.classList.add('active', 'new-chat-temp');
        sessionList.prepend(newChatLi);

        console.log("New chat session started.");
    }

    async function fetchAndDisplaySessions() {
        try {
            const response = await fetch('/sessions');
            const sessions = await response.json();
            sessionList.innerHTML = '';
            sessions.forEach(id => {
                const li = document.createElement('li');
                li.textContent = id;
                li.dataset.sessionId = id;
                if (id === sessionId) {
                    li.classList.add('active');
                }
                li.addEventListener('click', () => {
                    loadSession(id);
                });
                sessionList.appendChild(li);
            });
        } catch (error) {
            console.error('Failed to fetch sessions:', error);
        }
    }

    async function loadSession(id) {
        console.log("Loading session:", id);
        try {
            const response = await fetch(`/chat/history?session_id=${id}`);
            if (!response.ok) {
                throw new Error(`Failed to fetch history: ${response.statusText}`);
            }
            const history = await response.json();
            chatBox.innerHTML = '';
            history.forEach(msg => {
                const role = msg.role || 'system';
                const content = msg.content || '';
                const toolCalls = msg.tool_calls;

                // Handle tool results
                if (role === 'tool') {
                    const toolResultElement = createMessageElement('tool', content);
                    chatBox.appendChild(toolResultElement);
                    return; // Skip to next message in forEach
                }

                // Render content if it exists
                if (content) {
                    addMessage(role, content, false);
                }

                // Render tool calls if they exist
                if (toolCalls && toolCalls.length > 0) {
                    const assistantMessage = chatBox.querySelector('.message.assistant:last-child');
                    if (!assistantMessage) {
                        const newAssistantMessage = addMessage('assistant', '');
                        assistantMessage = newAssistantMessage;
                    }
                    const toolCallsContainer = document.createElement('div');
                    toolCallsContainer.className = 'tool-calls-container';

                    toolCalls.forEach((toolCall, index) => {
                        const toolCallElement = createToolCallElement(toolCall, index, false);
                        toolCallsContainer.appendChild(toolCallElement);
                    });

                    assistantMessage.appendChild(toolCallsContainer);
                }
            });
            sessionId = id;
            isNewSession = false;
            
            // 更新会话列表的激活状态
            const currentlyActive = sessionList.querySelector('.active');
            if (currentlyActive) {
                currentlyActive.classList.remove('active');
            }
            const newActiveItem = sessionList.querySelector(`li[data-session-id="${id}"]`);
            if (newActiveItem) {
                newActiveItem.classList.add('active');
            }

        } catch (error) {
            console.error('Failed to load session:', error);
            addMessage("system", `Error loading session ${id}.`);
        }
    }

    function sendMessage() {
        const content = messageInput.value.trim();
        if (content === "") {
            return;
        }

        addMessage("user", content);
        messageInput.value = "";
        
        // 直接调用流处理函数，避免重复请求
        handleStreamResponse(content);
    }
    
    // 辅助函数：转义HTML字符
    function escapeHTML(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    // 辅助函数：格式化工具调用
    function formatToolCall(toolCall) {
        let args = toolCall.function.arguments;
        try {
            const parsed = JSON.parse(args);
            args = JSON.stringify(parsed, null, 2);
        } catch (e) {
            // 如果不是完整的JSON，就按原样显示
        }
        return args || 'loading...';
    }

    // 创建工具调用HTML元素
    function createToolCallElement(toolCall, index, isStreaming = false) {
        const toolCallDiv = document.createElement('div');
        toolCallDiv.className = `tool-call ${isStreaming ? 'loading' : ''} tool-call-stream`;
        toolCallDiv.dataset.toolIndex = index;

        const headerDiv = document.createElement('div');
        headerDiv.className = 'tool-call-header';

        const titleDiv = document.createElement('div');
        titleDiv.className = 'tool-call-title';

        const iconDiv = document.createElement('div');
        iconDiv.className = 'tool-call-icon';
        iconDiv.textContent = '⚡';

        const nameSpan = document.createElement('span');
        nameSpan.textContent = toolCall.function.name || 'loading...';

        const statusSpan = document.createElement('span');
        statusSpan.className = `tool-call-status ${isStreaming ? 'loading' : 'completed'}`;
        statusSpan.textContent = isStreaming ? 'Executing...' : 'Completed';

        const toggleButton = document.createElement('button');
        toggleButton.className = 'tool-call-toggle';
        toggleButton.textContent = 'Show';
        toggleButton.onclick = () => toggleToolCallContent(toolCallDiv, toggleButton);

        const contentDiv = document.createElement('div');
        contentDiv.className = 'tool-call-content';

        const argsDiv = document.createElement('div');
        argsDiv.className = 'tool-call-args';
        argsDiv.textContent = formatToolCall(toolCall);

        // 组装元素
        titleDiv.appendChild(iconDiv);
        titleDiv.appendChild(nameSpan);
        headerDiv.appendChild(titleDiv);
        headerDiv.appendChild(statusSpan);
        headerDiv.appendChild(toggleButton);
        contentDiv.appendChild(argsDiv);
        toolCallDiv.appendChild(headerDiv);
        toolCallDiv.appendChild(contentDiv);

        return toolCallDiv;
    }

    // 切换工具调用内容显示/隐藏
    function toggleToolCallContent(toolCallElement, toggleButton) {
        const content = toolCallElement.querySelector('.tool-call-content');
        const isExpanded = content.classList.contains('expanded');

        if (isExpanded) {
            content.classList.remove('expanded');
            toggleButton.textContent = 'Show';
        } else {
            content.classList.add('expanded');
            toggleButton.textContent = 'Hide';
        }
    }

    // 更新工具调用状态
    function updateToolCallStatus(toolCallElement, status) {
        const statusElement = toolCallElement.querySelector('.tool-call-status');
        if (statusElement) {
            statusElement.className = `tool-call-status ${status}`;
            statusElement.textContent = status.charAt(0).toUpperCase() + status.slice(1);
        }

        // 更新工具调用容器的状态类
        toolCallElement.classList.remove('loading', 'completed', 'error');
        toolCallElement.classList.add(status);
    }

    // 更新工具调用显示
    function updateToolCallsDisplay(container, toolCalls, isStreaming = false) {
        // 过滤掉空的工具调用
        const validToolCalls = toolCalls.filter(tc => tc.function && (tc.function.name || tc.function.arguments));

        // 获取现有的工具调用元素
        const existingElements = container.querySelectorAll('.tool-call');
        const existingCount = existingElements.length;

        // 更新或添加工具调用元素
        validToolCalls.forEach((toolCall, index) => {
            let toolCallElement = existingElements[index];

            if (toolCallElement) {
                // 更新现有元素
                updateExistingToolCall(toolCallElement, toolCall, isStreaming);
            } else {
                // 创建新元素
                toolCallElement = createToolCallElement(toolCall, index, isStreaming);
                container.appendChild(toolCallElement);

                // 触发动画
                setTimeout(() => {
                    toolCallElement.style.animationDelay = '0s';
                }, 50);
            }
        });

        // 移除多余的元素
        for (let i = validToolCalls.length; i < existingCount; i++) {
            existingElements[i].remove();
        }
    }

    // 更新现有工具调用元素
    function updateExistingToolCall(element, toolCall, isStreaming) {
        const nameSpan = element.querySelector('.tool-call-title span');
        const argsDiv = element.querySelector('.tool-call-args');
        const statusSpan = element.querySelector('.tool-call-status');

        // 更新工具名称
        if (nameSpan && toolCall.function.name) {
            nameSpan.textContent = toolCall.function.name;
        }

        // 更新参数
        if (argsDiv) {
            argsDiv.textContent = formatToolCall(toolCall);
            if (isStreaming) {
                argsDiv.classList.add('streaming');
            } else {
                argsDiv.classList.remove('streaming');
            }
        }

        // 更新状态
        if (statusSpan) {
            updateToolCallStatus(element, isStreaming ? 'loading' : 'completed');
        }
    }

    async function handleStreamResponse(content) {
        try {
            const response = await fetch('/chat', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ content: content, session_id: sessionId }),
            });

            if (!response.body) {
                addMessage("system", "Streaming not supported or failed.");
                return;
            }
            
            const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
            
            let assistantMessageElement = null;
            let buffer = '';
            let currentToolCalls = []; // 用于累积工具调用片段
            let toolCallElement = null; // 用于跟踪工具调用的DOM元素

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
                                const eventData = JSON.parse(data);

                                if (eventData.session_id) {
                                    if(isNewSession) {
                                        sessionId = eventData.session_id;
                                        isNewSession = false;
                                        console.log("New session ID set:", sessionId);
                                        
                                        // 移除临时的 "New Chat" 项
                                        const tempNewChatItem = sessionList.querySelector('.new-chat-temp');
                                        if (tempNewChatItem) {
                                            tempNewChatItem.remove();
                                        }

                                        fetchAndDisplaySessions(); // 刷新会话列表
                                    }
                                }
                                
                                const msgData = eventData.data;
                                if (!msgData) {
                                    if (eventData.is_end) {
                                        assistantMessageElement = null;
                                    }
                                    continue;
                                }

                                const msg = JSON.parse(msgData);
                                console.log("OpenAgent: Received message:", msg);

                                // 处理工具结果消息
                                if (msg.role === 'tool') {
                                    console.log("OpenAgent: Processing tool result message:", msg);
                                    if (!assistantMessageElement) {
                                        console.log("OpenAgent: Creating assistant message for tool result");
                                        assistantMessageElement = addMessage("assistant", "");
                                    }
                                    const toolResultElement = createMessageElement('tool', msg.content);
                                    console.log("OpenAgent: Created tool result element:", toolResultElement);
                                    // 直接附加到助手消息元素，而不是查找.content
                                    assistantMessageElement.appendChild(toolResultElement);
                                    chatBox.scrollTop = chatBox.scrollHeight;
                                    console.log("OpenAgent: Tool result rendered successfully");
                                    continue;
                                }

                                if (msg.tool_calls && msg.tool_calls.length > 0) {
                                    // 确保有一个助手消息元素
                                    if (!assistantMessageElement) {
                                        assistantMessageElement = addMessage("assistant", "");
                                    }

                                    // 处理工具调用片段
                                    msg.tool_calls.forEach(part => {
                                        if (part.index === undefined || part.index === null) return;

                                        // 确保数组有足够的空间
                                        while (currentToolCalls.length <= part.index) {
                                            currentToolCalls.push({
                                                id: '',
                                                type: '',
                                                function: { name: '', arguments: '' }
                                            });
                                        }

                                        // 合并片段
                                        const existing = currentToolCalls[part.index];
                                        if (part.id) existing.id = part.id;
                                        if (part.type) existing.type = part.type;
                                        if (part.function) {
                                            if (part.function.name) existing.function.name = part.function.name;
                                            if (part.function.arguments) existing.function.arguments += part.function.arguments;
                                        }
                                    });

                                    // 获取或创建工具调用容器
                                    if (!toolCallElement) {
                                        toolCallElement = document.createElement('div');
                                        toolCallElement.className = 'tool-calls-container';
                                        assistantMessageElement.appendChild(toolCallElement);
                                    }

                                    // 更新工具调用显示
                                    updateToolCallsDisplay(toolCallElement, currentToolCalls, true);
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
        if (role === 'tool') {
            // 工具结果消息
            contentElement.classList.add("tool-result");
            try {
                const resultData = JSON.parse(content);
                contentElement.innerHTML = formatToolResult(resultData);
            } catch (e) {
                contentElement.textContent = content;
            }
        } else if (isToolCall) {
            contentElement.classList.add("tool-call");
            contentElement.textContent = content;
        } else {
            contentElement.classList.add("content");
            contentElement.textContent = content;
        }
        messageElement.appendChild(contentElement);

        return messageElement;
    }

    // 格式化工具结果
    function formatToolResult(result) {
        if (typeof result !== 'object') {
            return `<pre>${escapeHTML(result)}</pre>`;
        }

        let html = '<div class="tool-result-content">';

        if (result.success === false) {
            html += '<div class="tool-result-error">';
            html += `<span class="tool-result-status">❌ Error</span>`;
            if (result.error) {
                html += `<div class="tool-result-message">${escapeHTML(result.error)}</div>`;
            }
            html += '</div>';
        } else {
            html += '<div class="tool-result-success">';
            html += `<span class="tool-result-status">✅ Success</span>`;
            if (typeof result === 'object' && result !== null) {
                const resultStr = JSON.stringify(result, null, 2);
                html += `<pre class="tool-result-data">${escapeHTML(resultStr)}</pre>`;
            }
            html += '</div>';
        }

        html += '</div>';
        return html;
    }

    if (sendButton) {
        sendButton.addEventListener("click", function() {
            console.log("OpenAgent: Send button clicked");
            sendMessage();
        });
        console.log("OpenAgent: Send button event listener attached");
    } else {
        console.error("OpenAgent: Send button not found!");
    }

    if (newChatButton) {
        newChatButton.addEventListener("click", function() {
            console.log("OpenAgent: New chat button clicked");
            startNewChat();
        });
        console.log("OpenAgent: New chat button event listener attached");
    } else {
        console.error("OpenAgent: New chat button not found!");
    }

    if (messageInput) {
        messageInput.addEventListener("keypress", function(event) {
            if (event.key === "Enter") {
                console.log("OpenAgent: Enter key pressed");
                sendMessage();
            }
        });
        console.log("OpenAgent: Message input event listener attached");
    } else {
        console.error("OpenAgent: Message input not found!");
    }

    console.log("OpenAgent: Starting initialization...");
    startNewChat(); // 页面加载时直接开始一个新会话
    fetchAndDisplaySessions(); // 初始加载会话列表
}); 