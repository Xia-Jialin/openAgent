document.addEventListener("DOMContentLoaded", function() {
    const messageInput = document.getElementById("message-input");
    const sendButton = document.getElementById("send-button");
    const newChatButton = document.getElementById("new-chat-button");
    const chatBox = document.getElementById("chat-box");
    const sessionList = document.getElementById("session-list");
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

                // Render content if it exists
                if (content) {
                    addMessage(role, content, false);
                }

                // Render tool calls if they exist
                if (toolCalls && toolCalls.length > 0) {
                    const toolCallContent = toolCalls
                        .map(tc => formatToolCall(tc))
                        .join('\n\n');
                    // Tool calls are always from the assistant
                    addMessage('assistant', toolCallContent, true);
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
        return `Tool Call: ${toolCall.function.name || 'loading...'}\nArguments: ${args || 'loading...'}`;
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

                                    // 获取或创建工具调用元素
                                    if (!toolCallElement) {
                                        toolCallElement = document.createElement('div');
                                        toolCallElement.className = 'tool-call';
                                        assistantMessageElement.querySelector('.message-content').appendChild(toolCallElement);
                                    }

                                    // 格式化并显示当前的工具调用状态
                                    const formattedCalls = currentToolCalls
                                        .filter(tc => tc.function && (tc.function.name || tc.function.arguments))
                                        .map(formatToolCall)
                                        .join('\n\n');

                                    toolCallElement.innerHTML = `<pre>${escapeHTML(formattedCalls)}</pre>`;
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
    newChatButton.addEventListener("click", startNewChat);
    messageInput.addEventListener("keypress", function(event) {
        if (event.key === "Enter") {
            sendMessage();
        }
    });
    
    startNewChat(); // 页面加载时直接开始一个新会话
    fetchAndDisplaySessions(); // 初始加载会话列表
}); 