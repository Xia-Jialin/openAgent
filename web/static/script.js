document.addEventListener("DOMContentLoaded", function() {
    console.log("OpenAgent: DOM Content Loaded");

    // 获取所有DOM元素
    const elements = {
        // 首页元素
        projectInput: document.getElementById("project-input"),
        startProjectBtn: document.getElementById("start-project-btn"),
        projectsGrid: document.getElementById("projects-grid"),
        viewAllBtn: document.getElementById("view-all-btn"),

        // 项目视图元素
        homeView: document.getElementById("home-view"),
        projectView: document.getElementById("project-view"),
        backToHomeBtn: document.getElementById("back-to-home-btn"),
        currentProjectName: document.getElementById("current-project-name"),

        // 视图切换
        codeViewBtn: document.getElementById("code-view-btn"),
        previewViewBtn: document.getElementById("preview-view-btn"),
        codeView: document.getElementById("code-view"),
        previewView: document.getElementById("preview-view"),

        // 侧边栏
        filesTabBtn: document.getElementById("files-tab-btn"),
        aiTabBtn: document.getElementById("ai-tab-btn"),
        filesView: document.getElementById("files-view"),
        aiView: document.getElementById("ai-view"),

        // 文件树
        fileTree: document.getElementById("file-tree"),
        newFileBtn: document.getElementById("new-file-btn"),
        refreshFilesBtn: document.getElementById("refresh-files-btn"),
        collapseFilesBtn: document.getElementById("collapse-files-btn"),

        // AI助手
        clearChatBtn: document.getElementById("clear-chat-btn"),
        aiChatHistory: document.getElementById("ai-chat-history"),
        aiInput: document.getElementById("ai-input"),
        aiSendBtn: document.getElementById("ai-send-btn"),
        aiCancelBtn: document.getElementById("ai-cancel-btn"),

        // 代码编辑器
        currentFileName: document.getElementById("current-file-name"),
        codeEditorContent: document.getElementById("code-editor-content"),
        formatCodeBtn: document.getElementById("format-code-btn"),
        saveFileBtn: document.getElementById("save-file-btn"),

        // 预览
        refreshPreviewBtn: document.getElementById("refresh-preview-btn"),
        fullscreenPreviewBtn: document.getElementById("fullscreen-preview-btn"),
        previewIframe: document.getElementById("preview-iframe")
    };

    // 检查元素是否存在
    for (const [key, element] of Object.entries(elements)) {
        if (!element) {
            console.error(`Element not found: ${key}`);
        }
    }

    // 应用状态
    const state = {
        currentView: 'home',
        currentProject: null,
        currentFile: null,
        projects: [],
        files: [],
        aiChatHistory: [],
        isSending: false,
        isCreatingProject: false,
        creatingAiResponse: false,
        currentAiResponse: '',
        currentController: null,
        websocket: null,
        isPreviewLive: false,
        autoRefreshEnabled: true,
        lastFileUpdate: null
    };

    // 初始化应用
    async function init() {
        await loadProjects();
        setupEventListeners();
    }

    // WebSocket连接管理
    function connectWebSocket(sessionId) {
        // 如果已存在连接，先关闭
        if (state.websocket) {
            state.websocket.close();
            state.websocket = null;
        }

        const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${wsProtocol}//${window.location.host}/ws?session_id=${sessionId}`;

        try {
            state.websocket = new WebSocket(wsUrl);

            state.websocket.onopen = () => {
                console.log('WebSocket连接已建立');
                state.isPreviewLive = true;
                updatePreviewStatus();
            };

            state.websocket.onmessage = (event) => {
                const data = JSON.parse(event.data);
                handleWebSocketMessage(data);
            };

            state.websocket.onclose = () => {
                console.log('WebSocket连接已关闭');
                state.isPreviewLive = false;
                state.websocket = null;
                updatePreviewStatus();

                // 尝试重新连接
                setTimeout(() => {
                    if (state.currentProject && !state.websocket) {
                        connectWebSocket(state.currentProject);
                    }
                }, 3000);
            };

            state.websocket.onerror = (error) => {
                console.error('WebSocket错误:', error);
                state.isPreviewLive = false;
                updatePreviewStatus();
            };
        } catch (error) {
            console.error('WebSocket连接失败:', error);
            state.isPreviewLive = false;
        }
    }

    // 处理WebSocket消息
    function handleWebSocketMessage(data) {
        switch (data.type) {
            case 'file_change':
                handleFileChange(data.file, data.datetime);
                break;
            default:
                console.log('未知的消息类型:', data.type);
        }
    }

    // 处理文件变化
    function handleFileChange(filePath, datetime) {
        console.log(`文件变化: ${filePath} at ${datetime}`);

        // 防抖：避免频繁刷新
        if (state.lastFileUpdate && Date.now() - state.lastFileUpdate < 1000) {
            return;
        }

        state.lastFileUpdate = Date.now();

        // 如果是当前打开的文件，更新编辑器内容
        if (state.currentFile && state.currentFile.path === filePath) {
            // 可以选择是否自动重新加载文件内容
            if (state.autoRefreshEnabled) {
                loadCurrentFileContent();
            }
        }

        // 如果在预览视图，自动刷新预览
        if (state.currentView === 'preview' && state.autoRefreshEnabled) {
            debouncedRefreshPreview();
        }

        // 显示文件变化通知
        showFileChangeNotification(filePath);
    }

    // 显示文件变化通知
    function showFileChangeNotification(filePath) {
        // 检查是否已有通知
        let notification = document.querySelector('.file-change-notification');
        if (!notification) {
            notification = document.createElement('div');
            notification.className = 'file-change-notification';
            notification.style.cssText = `
                position: fixed;
                top: 20px;
                right: 20px;
                background: #28a745;
                color: white;
                padding: 10px 15px;
                border-radius: 5px;
                z-index: 1000;
                font-size: 14px;
                box-shadow: 0 2px 10px rgba(0,0,0,0.2);
                opacity: 0;
                transition: opacity 0.3s ease;
            `;
            document.body.appendChild(notification);
        }

        notification.textContent = `📄 文件已更新: ${filePath}`;
        notification.style.opacity = '1';

        // 3秒后隐藏通知
        setTimeout(() => {
            notification.style.opacity = '0';
            setTimeout(() => {
                if (notification.parentNode) {
                    notification.parentNode.removeChild(notification);
                }
            }, 300);
        }, 3000);
    }

    // 更新预览状态显示
    function updatePreviewStatus() {
        const previewHeader = document.querySelector('.preview-title');
        if (previewHeader) {
            if (state.isPreviewLive) {
                previewHeader.innerHTML = '📱 实时预览 <span class="live-indicator" style="color: #28a745;">● LIVE</span>';
            } else {
                previewHeader.innerHTML = '📱 实时预览 <span class="live-indicator" style="color: #dc3545;">● OFFLINE</span>';
            }
        }
    }

    // 防抖的预览刷新
    let refreshTimeout;
    function debouncedRefreshPreview() {
        clearTimeout(refreshTimeout);
        refreshTimeout = setTimeout(() => {
            refreshPreview();
        }, 500); // 500ms防抖
    }

    // 重新加载当前文件内容
    async function loadCurrentFileContent() {
        if (!state.currentFile || !state.currentFile.path) return;

        try {
            const response = await fetch(`/files/read?session_id=${state.currentProject}&path=${encodeURIComponent(state.currentFile.path)}`);
            const result = await response.json();
            if (result.success) {
                state.currentFile.content = result.content || '';
                elements.codeEditorContent.value = state.currentFile.content;
                document.querySelector('.save-status').textContent = '● 已同步';
                setTimeout(() => {
                    document.querySelector('.save-status').textContent = '● 已保存';
                }, 1000);
            }
        } catch (error) {
            console.error('重新加载文件失败:', error);
        }
    }

    // 加载项目列表
    async function loadProjects() {
        try {
            const response = await fetch('/sessions');
            const sessions = await response.json();
            state.projects = sessions.map(session => ({
                id: session.id,
                name: session.title || session.id,
                icon: '🎨',
                tech: 'AI Assistant',
                description: session.title || 'AI对话会话',
                lastModified: formatDateTime(session.updated_at),
                createdAt: session.created_at,
                workDir: session.work_dir
            }));
            renderProjects();
        } catch (error) {
            console.error('Failed to load projects:', error);
        }
    }

    // 格式化日期时间
    function formatDateTime(dateString) {
        const date = new Date(dateString);
        const now = new Date();
        const diffMs = now - date;
        const diffMins = Math.floor(diffMs / 60000);
        const diffHours = Math.floor(diffMs / 3600000);
        const diffDays = Math.floor(diffMs / 86400000);

        if (diffMins < 1) return '刚刚';
        if (diffMins < 60) return `${diffMins}分钟前`;
        if (diffHours < 24) return `${diffHours}小时前`;
        if (diffDays < 7) return `${diffDays}天前`;

        return date.toLocaleDateString('zh-CN');
    }

    // 渲染项目卡片
    function renderProjects() {
        elements.projectsGrid.innerHTML = '';
        state.projects.forEach(project => {
            const projectCard = createProjectCard(project);
            elements.projectsGrid.appendChild(projectCard);
        });
    }

    // 创建项目卡片
    function createProjectCard(project) {
        const card = document.createElement('div');
        card.className = 'project-card';
        card.innerHTML = `
            <div class="project-card-header">
                <div class="project-icon" style="background: ${getRandomColor()}">
                    ${project.icon}
                </div>
                <div class="project-info">
                    <h3>${project.name}</h3>
                    <p>${project.tech}</p>
                </div>
            </div>
            <div class="project-description">
                ${project.description}
            </div>
            <div class="project-card-footer">
                <span class="project-meta">最后修改: ${project.lastModified}</span>
                <div class="project-actions">
                    <button onclick="openProject('${project.id}')">继续编辑 →</button>
                    <button class="delete-btn" onclick="deleteProject('${project.id}', '${project.name}')" title="删除项目">
                        🗑️
                    </button>
                </div>
            </div>
        `;
        return card;
    }

    // 获取随机颜色
    function getRandomColor() {
        const colors = ['#007acc', '#28a745', '#dc3545', '#ffc107', '#17a2b8'];
        return colors[Math.floor(Math.random() * colors.length)];
    }

    // 打开项目
    function openProject(projectId) {
        state.currentProject = projectId;
        const project = state.projects.find(p => p.id === projectId);
        elements.currentProjectName.textContent = project ? project.name : projectId;
        showProjectView();
        loadProjectFiles(projectId);
        loadAiChatHistory(projectId);
        clearAiChat(); // 清空当前聊天历史

        // 连接WebSocket进行实时预览
        connectWebSocket(projectId);
    }

    // 删除项目
    async function deleteProject(projectId, projectName) {
        // 显示确认对话框
        const confirmed = confirm(`确定要删除项目"${projectName}"吗？\n\n此操作将删除项目的所有数据和文件，且无法恢复。`);

        if (!confirmed) {
            return; // 用户取消删除
        }

        try {
            // 显示删除中状态
            const deleteBtn = document.querySelector(`button[onclick="deleteProject('${projectId}', '${projectName}')"]`);
            const originalText = deleteBtn.innerHTML;
            deleteBtn.innerHTML = '🗑️ 删除中...';
            deleteBtn.disabled = true;

            const response = await fetch(`/sessions/${projectId}`, {
                method: 'DELETE',
                headers: {
                    'Content-Type': 'application/json'
                }
            });

            if (response.ok) {
                // 从状态中移除项目
                state.projects = state.projects.filter(p => p.id !== projectId);

                // 重新渲染项目列表
                renderProjects();

                // 如果当前正在查看被删除的项目，返回首页
                if (state.currentProject === projectId) {
                    state.currentProject = null;
                    showHomeView();
                }

                console.log(`项目 "${projectName}" 删除成功`);
            } else {
                const errorData = await response.json();
                throw new Error(errorData.error || `删除失败: ${response.status}`);
            }
        } catch (error) {
            console.error('删除项目失败:', error);
            alert(`删除项目失败: ${error.message}`);

            // 恢复按钮状态
            const deleteBtn = document.querySelector(`button[onclick="deleteProject('${projectId}', '${projectName}')"]`);
            if (deleteBtn) {
                deleteBtn.innerHTML = '🗑️';
                deleteBtn.disabled = false;
            }
        }
    }

    // 显示项目视图
    function showProjectView() {
        elements.homeView.classList.remove('active');
        elements.projectView.classList.add('active');
        state.currentView = 'project';
    }

    // 显示首页
    function showHomeView() {
        elements.projectView.classList.remove('active');
        elements.homeView.classList.add('active');
        state.currentView = 'home';
    }

    // 加载项目文件
    async function loadProjectFiles(projectId) {
        try {
            const response = await fetch(`/files/list?session_id=${projectId}`);
            const files = await response.json();

            // 解析文件结构
            state.files = parseFileStructure(files);
            renderFileTree();
        } catch (error) {
            console.error('Failed to load project files:', error);
        }
    }

    // 解析文件结构
    function parseFileStructure(files) {
        if (!files || !Array.isArray(files)) return [];

        return files.map(file => {
            if (file.type === 'folder') {
                return {
                    name: file.name,
                    type: 'folder',
                    children: file.children ? parseFileStructure(file.children) : []
                };
            } else {
                return {
                    name: file.name,
                    type: 'file',
                    path: file.path || file.name,
                    content: file.content || ''
                };
            }
        });
    }

    // 渲染文件树
    function renderFileTree() {
        elements.fileTree.innerHTML = '';
        state.files.forEach(item => {
            const fileElement = createFileElement(item);
            elements.fileTree.appendChild(fileElement);
        });
    }

    // 创建文件元素
    function createFileElement(item, level = 0) {
        const element = document.createElement('div');
        element.style.marginLeft = `${level * 15}px`;

        if (item.type === 'folder') {
            element.innerHTML = `
                <div class="file-folder">
                    <span>📁 ${item.name}</span>
                </div>
            `;
            const childrenContainer = document.createElement('div');
            childrenContainer.className = 'file-children';
            if (item.children) {
                item.children.forEach(child => {
                    const childElement = createFileElement(child, level + 1);
                    childrenContainer.appendChild(childElement);
                });
            }
            element.appendChild(childrenContainer);
        } else {
            element.innerHTML = `
                <div class="file-item" data-file="${item.name}">
                    <span>📄 ${item.name}</span>
                </div>
            `;
            element.querySelector('.file-item').addEventListener('click', () => openFile(item));
        }

        return element;
    }

    // 打开文件
    async function openFile(file) {
        state.currentFile = file;
        elements.currentFileName.textContent = `📄 ${file.name}`;

        // 如果文件内容为空，从后端获取
        if (!file.content && file.path) {
            try {
                const response = await fetch(`/files/read?session_id=${state.currentProject}&path=${encodeURIComponent(file.path)}`);
                const result = await response.json();
                if (result.success) {
                    file.content = result.content || '';
                } else {
                    file.content = `// Error: ${result.error || 'Failed to load file'}`;
                }
            } catch (error) {
                console.error('Failed to load file content:', error);
                file.content = `// Error: Failed to load file content`;
            }
        }

        elements.codeEditorContent.value = file.content || '';

        // 更新文件树中的活动状态
        document.querySelectorAll('.file-item').forEach(item => {
            item.classList.remove('active');
        });
        document.querySelector(`[data-file="${file.name}"]`)?.classList.add('active');
    }

    // 设置事件监听器
    function setupEventListeners() {
        // 首页事件
        elements.startProjectBtn.addEventListener('click', createNewProject);
        elements.projectInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') createNewProject();
        });

        // 导航事件
        elements.backToHomeBtn.addEventListener('click', showHomeView);

        // 视图切换
        elements.codeViewBtn.addEventListener('click', () => switchView('code'));
        elements.previewViewBtn.addEventListener('click', () => switchView('preview'));

        // 侧边栏切换
        elements.filesTabBtn.addEventListener('click', () => switchSidebar('files'));
        elements.aiTabBtn.addEventListener('click', () => switchSidebar('ai'));

        // AI助手事件
        elements.aiSendBtn.addEventListener('click', sendAiMessage);
        elements.aiInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendAiMessage();
            }
        });
        elements.clearChatBtn.addEventListener('click', clearAiChat);
        if (elements.aiCancelBtn) {
            elements.aiCancelBtn.addEventListener('click', cancelCurrentRequest);
        }

        // 文件操作事件
        elements.newFileBtn.addEventListener('click', createNewFile);
        elements.refreshFilesBtn.addEventListener('click', () => {
            if (state.currentProject) {
                loadProjectFiles(state.currentProject);
            }
        });
        elements.collapseFilesBtn.addEventListener('click', collapseFileTree);

        // 代码编辑器事件
        elements.formatCodeBtn.addEventListener('click', formatCode);
        elements.saveFileBtn.addEventListener('click', saveFile);
        elements.codeEditorContent.addEventListener('input', markAsUnsaved);

        // 预览事件
        elements.refreshPreviewBtn.addEventListener('click', refreshPreview);
        elements.fullscreenPreviewBtn.addEventListener('click', toggleFullscreenPreview);

        // 设备切换事件
        document.querySelectorAll('.device-btn').forEach(btn => {
            btn.addEventListener('click', () => switchDevice(btn.dataset.device));
        });

        // 响应式处理
        handleResponsive();
        window.addEventListener('resize', debounce(handleResponsive, 250));
        window.addEventListener('orientationchange', handleResponsive);
    }

    // 响应式处理函数
    function handleResponsive() {
        const width = window.innerWidth;
        const height = window.innerHeight;

        // 添加屏幕尺寸类到body
        document.body.classList.remove('screen-xs', 'screen-sm', 'screen-md', 'screen-lg', 'screen-xl');

        if (width < 576) {
            document.body.classList.add('screen-xs');
        } else if (width < 768) {
            document.body.classList.add('screen-sm');
        } else if (width < 992) {
            document.body.classList.add('screen-md');
        } else if (width < 1200) {
            document.body.classList.add('screen-lg');
        } else {
            document.body.classList.add('screen-xl');
        }

        // 移动端优化
        if (width < 768) {
            optimizeForMobile();
        } else {
            optimizeForDesktop();
        }

        // 横屏模式优化
        if (width > height && height < 600) {
            optimizeForLandscape();
        } else {
            optimizeForPortrait();
        }

        // 调整编辑器高度
        adjustEditorHeight();

        // 监听视图切换，确保高度正确
        setupViewHeightObservers();

        console.log(`Screen resized to: ${width}x${height}`);
    }

    // 移动端优化
    function optimizeForMobile() {
        // 在小屏幕上自动折叠侧边栏以节省空间
        const sidebar = document.querySelector('.sidebar');
        if (sidebar && state.currentView === 'project') {
            // 可以根据需要添加移动端特定的优化
        }

        // 优化触摸交互
        document.querySelectorAll('button, .project-card, .file-item').forEach(element => {
            element.style.minHeight = '44px';
        });

        // 调整字体大小
        document.body.style.fontSize = '14px';
    }

    // 桌面端优化
    function optimizeForDesktop() {
        // 恢复桌面端设置
        document.querySelectorAll('button, .project-card, .file-item').forEach(element => {
            element.style.minHeight = '';
        });

        document.body.style.fontSize = '';
    }

    // 横屏模式优化
    function optimizeForLandscape() {
        const homeHeader = document.querySelector('.home-header');
        if (homeHeader) {
            homeHeader.style.padding = '30px 20px';
        }
    }

    // 竖屏模式优化
    function optimizeForPortrait() {
        const homeHeader = document.querySelector('.home-header');
        if (homeHeader) {
            homeHeader.style.padding = '';
        }
    }

    // 调整编辑器高度
    function adjustEditorHeight() {
        const projectView = document.querySelector('.project-view');
        const projectHeader = document.querySelector('.project-header');
        const codeView = document.getElementById('code-view');
        const previewView = document.getElementById('preview-view');
        const codeHeader = document.querySelector('.code-header');
        const previewHeader = document.querySelector('.preview-header');

        if (!projectView || !projectHeader) return;

        // 计算可用高度
        const headerHeight = projectHeader.offsetHeight;
        const viewportHeight = window.innerHeight;
        const availableHeight = viewportHeight - headerHeight;

        // 确保最小高度
        const minHeight = Math.max(availableHeight, 400);

        // 调整project-content高度
        const projectContent = document.querySelector('.project-content');
        if (projectContent) {
            projectContent.style.height = `${availableHeight}px`;
        }

        // 调整侧边栏高度
        const sidebar = document.querySelector('.sidebar');
        if (sidebar) {
            sidebar.style.maxHeight = `${availableHeight}px`;
            sidebar.style.height = `${availableHeight}px`;
        }

        // 调整主要区域高度
        const mainArea = document.querySelector('.main-area');
        if (mainArea) {
            mainArea.style.height = `${availableHeight}px`;
        }

        // 调整代码编辑器高度
        if (codeView && codeHeader) {
            const codeHeaderHeight = codeHeader.offsetHeight;
            const codeAvailableHeight = availableHeight - codeHeaderHeight;
            const codeEditor = codeView.querySelector('.code-editor');
            if (codeEditor) {
                codeEditor.style.height = `${Math.max(codeAvailableHeight, 300)}px`;
            }
        }

        // 调整预览区域高度
        if (previewView && previewHeader) {
            const previewHeaderHeight = previewHeader.offsetHeight;
            const previewAvailableHeight = availableHeight - previewHeaderHeight;
            const previewContent = previewView.querySelector('.preview-content');
            if (previewContent) {
                previewContent.style.height = `${Math.max(previewAvailableHeight, 300)}px`;
            }
        }

        console.log(`Adjusted heights - Viewport: ${viewportHeight}, Header: ${headerHeight}, Available: ${availableHeight}`);
    }

    // 防抖函数
    function debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }

    // 创建新项目
    async function createNewProject() {
        const description = elements.projectInput.value.trim();
        if (!description) return;

        // 防止重复创建
        if (state.isCreatingProject) {
            console.log('项目创建中，请稍候...');
            return;
        }

        state.isCreatingProject = true;
        const controller = new AbortController();

        // 设置超时
        const timeout = setTimeout(() => {
            controller.abort();
            alert('创建项目超时，请重试。');
            state.isCreatingProject = false;
        }, 30000); // 30秒超时

        try {
            // 创建新会话
            const response = await fetch('/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ content: description }),
                signal: controller.signal
            });

            clearTimeout(timeout);

            if (response.ok) {
                const reader = response.body.getReader();
                const decoder = new TextDecoder();

                // 设置SSE读取超时
                const sseTimeout = setTimeout(() => {
                    reader.cancel();
                    alert('读取响应超时，请重试。');
                    state.isCreatingProject = false;
                }, 60000);

                try {
                    while (true) {
                        const { done, value } = await Promise.race([
                            reader.read(),
                            new Promise((_, reject) =>
                                setTimeout(() => reject(new Error('Read timeout')), 5000)
                            )
                        ]);

                        if (done) break;

                        const chunk = decoder.decode(value);
                        const lines = chunk.split('\n');

                        for (const line of lines) {
                            if (line.startsWith('data:')) {
                                const data = line.substring(5).trim();
                                if (data) {
                                    try {
                                        const eventData = JSON.parse(data);

                                        // 处理session_id
                                        if (eventData.session_id && !state.currentProject) {
                                            const newProject = {
                                                id: eventData.session_id,
                                                name: `项目-${eventData.session_id.substring(0, 8)}`,
                                                icon: '🚀',
                                                tech: 'React + Tailwind CSS',
                                                description: description,
                                                lastModified: '刚刚'
                                            };
                                            state.projects.unshift(newProject);
                                            renderProjects();
                                            openProject(eventData.session_id);
                                            elements.projectInput.value = '';

                                            // 在新项目中添加用户消息
                                            addAiMessage('user', description);
                                        }

                                        // 处理AI回复内容
                                        const msgData = eventData.data;
                                        if (msgData) {
                                            try {
                                                const msg = JSON.parse(msgData);

                                                if (msg.role === 'tool') {
                                                    // 处理工具调用结果
                                                    try {
                                                        const toolResult = JSON.parse(msg.content);
                                                        addToolMessage(toolResult);
                                                    } catch (toolError) {
                                                        console.error('Error parsing tool result:', toolError);
                                                        addToolMessage({
                                                            success: false,
                                                            error: '工具结果解析失败'
                                                        });
                                                    }
                                                } else if (msg.content) {
                                                    // 处理普通AI回复 - 实现打字机效果
                                                    // 如果是第一条消息内容，先创建空的AI消息
                                                    if (!state.creatingAiResponse) {
                                                        addAiMessage('assistant', '');
                                                        state.creatingAiResponse = true;
                                                        state.currentAiResponse = '';
                                                    }

                                                    // 累加内容并更新显示
                                                    state.currentAiResponse += msg.content;
                                                    updateLastAiMessage(state.currentAiResponse);
                                                }
                                            } catch (msgError) {
                                                console.error('Error parsing message data:', msgError);
                                            }
                                        }

                                        // 处理结束标记
                                        if (eventData.is_end) {
                                            clearTimeout(sseTimeout);
                                            state.isCreatingProject = false;
                                            state.creatingAiResponse = false;
                                            state.currentAiResponse = '';
                                            return; // 成功创建，退出函数
                                        }
                                    } catch (e) {
                                        console.error('Error parsing SSE data:', e);
                                    }
                                }
                            }
                        }
                    }
                } catch (readError) {
                    console.error('SSE读取错误:', readError);
                    if (readError.message !== 'Read timeout') {
                        alert('创建项目时读取响应失败，请重试。');
                    }
                } finally {
                    clearTimeout(sseTimeout);
                }
            } else {
                alert(`创建项目失败: ${response.status}`);
            }
        } catch (error) {
            clearTimeout(timeout);
            if (error.name === 'AbortError') {
                console.log('项目创建被取消');
            } else {
                console.error('Error creating project:', error);
                alert('创建项目失败，请稍后重试。');
            }
        } finally {
            state.isCreatingProject = false;
            state.creatingAiResponse = false;
            state.currentAiResponse = '';
        }
    }

    // 切换视图
    function switchView(view) {
        if (view === 'code') {
            elements.codeView.classList.add('active');
            elements.previewView.classList.remove('active');
            elements.codeViewBtn.classList.add('active');
            elements.previewViewBtn.classList.remove('active');
        } else {
            elements.previewView.classList.add('active');
            elements.codeView.classList.remove('active');
            elements.previewViewBtn.classList.add('active');
            elements.codeViewBtn.classList.remove('active');
            refreshPreview();
        }
    }

    // 切换侧边栏
    function switchSidebar(sidebar) {
        if (sidebar === 'files') {
            elements.filesView.classList.add('active');
            elements.aiView.classList.remove('active');
            elements.filesTabBtn.classList.add('active');
            elements.aiTabBtn.classList.remove('active');
        } else {
            elements.aiView.classList.add('active');
            elements.filesView.classList.remove('active');
            elements.aiTabBtn.classList.add('active');
            elements.filesTabBtn.classList.remove('active');
        }
    }

    // 防抖函数
    function debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }

    // 防抖的DOM更新函数
    let updateTimeout;
    function debouncedUpdateAIResponse(content) {
        clearTimeout(updateTimeout);
        updateTimeout = setTimeout(() => {
            updateLastAiMessage(content);
        }, 100); // 100ms防抖
    }

    // 防抖的AI聊天布局优化
    let layoutOptimizeTimeout;
    function debouncedOptimizeAiChatLayout() {
        clearTimeout(layoutOptimizeTimeout);
        layoutOptimizeTimeout = setTimeout(() => {
            optimizeAiChatLayout();
        }, 100); // 100ms防抖
    }

    // 取消当前请求
    function cancelCurrentRequest() {
        if (state.currentController) {
            state.currentController.abort();
            state.currentController = null;
        }
        state.isSending = false;
        updateSendButtonState();
        addAiMessage('system', '请求已取消。');
    }

    // 更新发送按钮状态
    function updateSendButtonState() {
        if (elements.aiSendBtn) {
            elements.aiSendBtn.disabled = state.isSending;
            elements.aiSendBtn.textContent = state.isSending ? '发送中...' : '发送';
        }
        if (elements.aiCancelBtn) {
            elements.aiCancelBtn.style.display = state.isSending ? 'inline-block' : 'none';
        }
        if (elements.aiInput) {
            elements.aiInput.disabled = state.isSending;
        }
    }

    // 发送AI消息
    async function sendAiMessage() {
        const message = elements.aiInput.value.trim();
        if (!message || !state.currentProject) return;

        // 检查是否有正在进行的请求
        if (state.isSending) {
            console.log('已有请求正在进行，请等待完成');
            // 可选：取消当前请求
            // cancelCurrentRequest();
            return;
        }

        console.log('Sending AI message:', message);
        console.log('Input container before send:', elements.aiInput.parentElement);

        state.isSending = true;
        state.currentController = new AbortController();
        updateSendButtonState();

        addAiMessage('user', message);
        elements.aiInput.value = '';

        // 确保输入框保持可见
        setTimeout(() => {
            const aiInputContainer = document.querySelector('.ai-input-container');
            if (aiInputContainer) {
                aiInputContainer.style.display = 'flex';
                aiInputContainer.style.visibility = 'visible';
                console.log('Input container after send:', aiInputContainer.style.display);
            }
        }, 100);

        // 设置请求超时
        const requestTimeout = setTimeout(() => {
            cancelCurrentRequest();
            addAiMessage('system', '请求超时，请稍后重试。');
        }, 30000); // 30秒超时

        try {
            const response = await fetch('/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    content: message,
                    session_id: state.currentProject
                }),
                signal: state.currentController.signal
            });

            clearTimeout(requestTimeout);

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            // 处理流式响应
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let aiResponse = '';
            let isFirstMessage = true;

            // 设置SSE读取超时
            const sseTimeout = setTimeout(() => {
                console.error('SSE读取超时');
                reader.cancel();
                addAiMessage('system', '响应读取超时，请重试。');
            }, 60000); // 60秒超时

            try {
                while (true) {
                    const { done, value } = await Promise.race([
                        reader.read(),
                        new Promise((_, reject) =>
                            setTimeout(() => reject(new Error('Read timeout')), 5000)
                        )
                    ]);

                    if (done) break;

                    const chunk = decoder.decode(value);
                    const lines = chunk.split('\n');

                    for (const line of lines) {
                        if (line.startsWith('data:')) {
                            const data = line.substring(5).trim();
                            if (data) {
                                try {
                                    const eventData = JSON.parse(data);

                                    // 处理session_id
                                    if (eventData.session_id && isFirstMessage) {
                                        isFirstMessage = false;
                                        // 可以在这里更新session状态
                                    }

                                    // 处理结束标记
                                    if (eventData.is_end) {
                                        clearTimeout(sseTimeout);
                                        // 确保在成功完成后重置发送状态
                                        state.isSending = false;
                                        state.currentController = null;
                                        updateSendButtonState();
                                        continue;
                                    }

                                    const msgData = eventData.data;
                                    if (msgData) {
                                        const msg = JSON.parse(msgData);

                                        if (msg.role === 'tool') {
                                            // 处理工具调用结果
                                            try {
                                                const toolResult = JSON.parse(msg.content);
                                                addToolMessage(toolResult);
                                            } catch (toolError) {
                                                console.error('Error parsing tool result:', toolError);
                                                addToolMessage({
                                                    success: false,
                                                    error: '工具结果解析失败'
                                                });
                                            }
                                        } else if (msg.content) {
                                            // 处理普通消息 - 使用防抖优化
                                            // 如果是第一条消息内容，先创建空的AI消息
                                            if (aiResponse === '') {
                                                addAiMessage('assistant', '');
                                            }

                                            aiResponse += msg.content;
                                            debouncedUpdateAIResponse(aiResponse);
                                        }
                                    }
                                } catch (e) {
                                    console.error('Error parsing SSE data:', e, 'data:', data);
                                    // 不要因为解析错误而中断流程
                                }
                            }
                        }
                    }
                }

                // 确保在正常完成后重置发送状态
                state.isSending = false;
                state.currentController = null;
                updateSendButtonState();
            } catch (readError) {
                console.error('SSE读取错误:', readError);
                if (readError.message === 'Read timeout') {
                    addAiMessage('system', '读取响应超时，请重试。');
                } else {
                    addAiMessage('system', '读取响应时出错，请重试。');
                }
            } finally {
                clearTimeout(sseTimeout);
                // 确保在成功完成后重置发送状态
                state.isSending = false;
                state.currentController = null;
                updateSendButtonState();
            }
        } catch (error) {
            clearTimeout(requestTimeout);
            if (error.name === 'AbortError') {
                console.log('请求被取消');
                addAiMessage('system', '请求已取消。');
            } else {
                console.error('Error sending AI message:', error);
                addAiMessage('system', '发送消息时出错，请稍后重试。');
            }
        } finally {
            state.isSending = false;
            state.currentController = null;
        }
    }

    // 添加工具消息
    function addToolMessage(toolResult) {
        const messageDiv = document.createElement('div');
        messageDiv.className = 'ai-message tool-message';

        const isSuccess = toolResult.success !== false;
        const icon = isSuccess ? '🔧' : '❌';
        const title = isSuccess ? '工具执行结果' : '工具执行失败';

        let content = '';
        if (isSuccess) {
            content = toolResult.result || '工具执行成功';
        } else {
            content = toolResult.error || '工具执行失败';
        }

        messageDiv.innerHTML = `
            <div class="ai-role tool">
                ${icon} ${title}
            </div>
            <div class="tool-content">
                <pre>${JSON.stringify(content, null, 2)}</pre>
            </div>
        `;
        elements.aiChatHistory.appendChild(messageDiv);
        elements.aiChatHistory.scrollTop = elements.aiChatHistory.scrollHeight;
        state.aiChatHistory.push({ role: 'tool', content: JSON.stringify(toolResult) });
    }

    // 添加AI消息
    function addAiMessage(role, content) {
        const messageDiv = document.createElement('div');
        messageDiv.className = 'ai-message';
        messageDiv.innerHTML = `
            <div class="ai-role ${role === 'user' ? 'user' : 'ai'}">
                ${role === 'user' ? '👤 用户:' : '🤖 AI助手:'}
            </div>
            <div>${content}</div>
        `;
        elements.aiChatHistory.appendChild(messageDiv);
        elements.aiChatHistory.scrollTop = elements.aiChatHistory.scrollHeight;
        state.aiChatHistory.push({ role, content });

        // 优化AI聊天布局
        setTimeout(() => {
            debouncedOptimizeAiChatLayout();
        }, 50);
    }

    // 更新最后一条AI消息
    function updateLastAiMessage(content) {
        const lastMessage = elements.aiChatHistory.lastElementChild;
        if (lastMessage && lastMessage.querySelector('.ai-role.ai')) {
            lastMessage.lastElementChild.textContent = content;
            elements.aiChatHistory.scrollTop = elements.aiChatHistory.scrollHeight;

            // 优化AI聊天布局
            setTimeout(() => {
                debouncedOptimizeAiChatLayout();
            }, 50);
        }
    }

    // 加载AI聊天历史
    async function loadAiChatHistory(sessionId) {
        try {
            const response = await fetch(`/chat/history?session_id=${sessionId}`);
            const history = await response.json();

            // 清空当前聊天历史
            clearAiChat();

            // 加载历史消息到界面
            history.forEach(message => {
                if (message.role !== 'system') { // 跳过系统消息
                    addAiMessage(message.role, message.content);
                }
            });

            console.log(`Loaded ${history.length} messages for session ${sessionId}`);
        } catch (error) {
            console.error('Failed to load AI chat history:', error);
        }
    }

    // 清空AI聊天
    function clearAiChat() {
        elements.aiChatHistory.innerHTML = '';
        state.aiChatHistory = [];
    }

    // 创建新文件
    function createNewFile() {
        const fileName = prompt('请输入文件名：');
        if (fileName) {
            const newFile = {
                name: fileName,
                type: 'file',
                content: ''
            };
            state.files.push(newFile);
            renderFileTree();
            openFile(newFile);
        }
    }

    // 折叠文件树
    function collapseFileTree() {
        document.querySelectorAll('.file-children').forEach(child => {
            child.style.display = 'none';
        });
    }

    // 格式化代码
    function formatCode() {
        // 这里应该调用代码格式化服务
        alert('代码格式化功能正在开发中...');
    }

    // 保存文件
    function saveFile() {
        if (state.currentFile) {
            state.currentFile.content = elements.codeEditorContent.value;
            document.querySelector('.save-status').textContent = '● 已保存';

            // 这里应该调用保存到后端的API
            setTimeout(() => {
                document.querySelector('.save-status').textContent = '● 已保存';
            }, 1000);
        }
    }

    // 标记为未保存
    function markAsUnsaved() {
        document.querySelector('.save-status').textContent = '● 未保存';
    }

    // 刷新预览
    async function refreshPreview() {
        try {
            const indexFile = findFileByName('index.html');
            if (indexFile) {
                // 如果有index.html文件，使用HTTP路由访问
                const previewUrl = `/workspace/${state.currentProject}/${indexFile.path}`;
                elements.previewIframe.src = previewUrl;
                console.log('预览已刷新 (HTTP路由):', previewUrl);
            } else {
                // 否则生成一个默认的预览页面
                const htmlContent = await generateDefaultPreview();
                elements.previewIframe.srcdoc = htmlContent;
                console.log('预览已刷新 (默认页面)');
            }
        } catch (error) {
            console.error('刷新预览失败:', error);
        }
    }

    // 生成预览HTML
    async function generatePreviewHtml() {
        // 尝试找到index.html文件
        const indexFile = findFileByName('index.html');
        let htmlContent = '';

        if (indexFile) {
            // 如果有index.html文件，使用其内容
            htmlContent = await loadFileContent(indexFile.path);
        } else {
            // 否则生成一个默认的预览页面
            htmlContent = generateDefaultPreview();
        }

        return htmlContent;
    }

    // 查找文件
    function findFileByName(fileName) {
        function searchInFiles(files) {
            for (const file of files) {
                if (file.type === 'file' && file.name === fileName) {
                    return file;
                } else if (file.type === 'folder' && file.children) {
                    const found = searchInFiles(file.children);
                    if (found) return found;
                }
            }
            return null;
        }
        return searchInFiles(state.files);
    }

    // 加载文件内容
    async function loadFileContent(filePath) {
        try {
            const response = await fetch(`/files/read?session_id=${state.currentProject}&path=${encodeURIComponent(filePath)}`);
            const result = await response.json();
            if (result.success) {
                return result.content || '';
            }
        } catch (error) {
            console.error('加载文件失败:', error);
        }
        return '';
    }

    // 生成默认预览页面
    function generateDefaultPreview() {
        const cssFiles = state.files.filter(f => f.type === 'file' && f.name.endsWith('.css'));
        const jsFiles = state.files.filter(f => f.type === 'file' && f.name.endsWith('.js'));

        return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>项目预览 - ${state.currentProject || '项目'}</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            margin: 0;
            padding: 20px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            color: #333;
        }
        .container {
            max-width: 1200px;
            margin: 0 auto;
            background: white;
            border-radius: 12px;
            padding: 30px;
            box-shadow: 0 20px 40px rgba(0,0,0,0.1);
        }
        .header {
            text-align: center;
            margin-bottom: 30px;
            padding-bottom: 20px;
            border-bottom: 2px solid #f0f0f0;
        }
        .header h1 {
            margin: 0;
            color: #2c3e50;
            font-size: 2.5em;
        }
        .header p {
            margin: 10px 0 0 0;
            color: #7f8c8d;
            font-size: 1.2em;
        }
        .content {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
            gap: 20px;
            margin-bottom: 30px;
        }
        .card {
            background: #f8f9fa;
            border-radius: 8px;
            padding: 20px;
            border-left: 4px solid #3498db;
        }
        .card h3 {
            margin: 0 0 10px 0;
            color: #2c3e50;
        }
        .file-list {
            background: #f8f9fa;
            border-radius: 8px;
            padding: 20px;
        }
        .file-list h3 {
            margin: 0 0 15px 0;
            color: #2c3e50;
        }
        .file-item {
            display: flex;
            align-items: center;
            padding: 8px 0;
            border-bottom: 1px solid #ecf0f1;
        }
        .file-item:last-child {
            border-bottom: none;
        }
        .file-icon {
            margin-right: 10px;
            font-size: 1.2em;
        }
        .live-indicator {
            position: fixed;
            top: 20px;
            right: 20px;
            background: ${state.isPreviewLive ? '#28a745' : '#dc3545'};
            color: white;
            padding: 10px 15px;
            border-radius: 20px;
            font-size: 12px;
            font-weight: bold;
            z-index: 1000;
            animation: pulse 2s infinite;
        }
        @keyframes pulse {
            0% { opacity: 1; }
            50% { opacity: 0.7; }
            100% { opacity: 1; }
        }
        /* 动态加载的CSS */
        ${cssFiles.length > 0 ? cssFiles.map(file => `<link rel="stylesheet" href="data:text/css;base64,${btoa(file.content || '')}">`).join('\n') : ''}
    </style>
</head>
<body>
    <div class="live-indicator">
        ${state.isPreviewLive ? '🟢 LIVE' : '🔴 OFFLINE'}
    </div>

    <div class="container">
        <div class="header">
            <h1>🚀 项目预览</h1>
            <p>${state.currentProject ? '会话: ' + state.currentProject : '实时预览模式'}</p>
            <p>最后更新: ${new Date().toLocaleString('zh-CN')}</p>
        </div>

        <div class="content">
            <div class="card">
                <h3>📁 项目文件</h3>
                <p>共有 <strong>${state.files.length}</strong> 个文件</p>
                <p>支持HTML、CSS、JavaScript实时预览</p>
            </div>

            <div class="card">
                <h3>⚡ 实时更新</h3>
                <p>文件变化时自动刷新预览</p>
                <p>支持热重载和同步编辑</p>
            </div>
        </div>

        <div class="file-list">
            <h3>📄 文件列表</h3>
            ${state.files.map(file => {
                if (file.type === 'file') {
                    return `<div class="file-item">
                        <span class="file-icon">📄</span>
                        <span>${file.name}</span>
                    </div>`;
                } else {
                    return `<div class="file-item">
                        <span class="file-icon">📁</span>
                        <span><strong>${file.name}</strong> (${file.children.length} 个文件)</span>
                    </div>`;
                }
            }).join('')}
        </div>

        <div id="app">
            <!-- 应用内容将在这里显示 -->
        </div>
    </div>

    <!-- 动态加载的JavaScript -->
    ${jsFiles.length > 0 ? jsFiles.map(file => `<script>${file.content || ''}</script>`).join('\n') : ''}

    <script>
        console.log('预览页面已加载');
        console.log('WebSocket状态: ${state.isPreviewLive ? '已连接' : '未连接'}');

        // 简单的实时更新测试
        if (${state.isPreviewLive}) {
            setInterval(() => {
                const timeElement = document.querySelector('.live-time');
                if (timeElement) {
                    timeElement.textContent = new Date().toLocaleTimeString('zh-CN');
                }
            }, 1000);
        }
    </script>
</body>
</html>`;
    }

    // 切换设备
    function switchDevice(device) {
        document.querySelectorAll('.device-btn').forEach(btn => {
            btn.classList.remove('active');
        });
        document.querySelector(`[data-device="${device}"]`)?.classList.add('active');

        // 根据设备调整iframe大小
        const iframe = elements.previewIframe;
        switch (device) {
            case 'mobile':
                iframe.style.width = '375px';
                iframe.style.height = '667px';
                break;
            case 'tablet':
                iframe.style.width = '768px';
                iframe.style.height = '1024px';
                break;
            default:
                iframe.style.width = '100%';
                iframe.style.height = '100%';
        }
    }

    // 切换全屏预览
    function toggleFullscreenPreview() {
        const previewContent = elements.previewContent;
        if (!document.fullscreenElement) {
            previewContent.requestFullscreen();
        } else {
            document.exitFullscreen();
        }
    }

    // 设置视图高度监听
    function setupViewHeightObservers() {
        // 监听主视图切换
        const homeView = document.getElementById('home-view');
        const projectView = document.getElementById('project-view');

        if (homeView && projectView) {
            const observer = new MutationObserver((mutations) => {
                mutations.forEach((mutation) => {
                    if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
                        const isActive = projectView.classList.contains('active');
                        if (isActive) {
                            // 切换到项目视图时，延迟调整高度确保DOM更新完成
                            setTimeout(() => {
                                adjustEditorHeight();
                                adjustSidebarHeight();
                                debouncedOptimizeAiChatLayout();
                            }, 100);
                        }
                    }
                });
            });

            observer.observe(projectView, { attributes: true });
        }

        // 监听代码/预览视图切换
        const codeView = document.getElementById('code-view');
        const previewView = document.getElementById('preview-view');

        [codeView, previewView].forEach(view => {
            if (view) {
                const observer = new MutationObserver((mutations) => {
                    mutations.forEach((mutation) => {
                        if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
                            const isActive = view.classList.contains('active');
                            if (isActive) {
                                setTimeout(() => {
                                    adjustEditorHeight();
                                    debouncedOptimizeAiChatLayout();
                                }, 50);
                            }
                        }
                    });
                });

                observer.observe(view, { attributes: true });
            }
        });

        // 监听AI聊天历史变化 - 使用防抖避免频繁调用
        const aiChatHistory = document.getElementById('ai-chat-history');
        if (aiChatHistory) {
            const observer = new MutationObserver((mutations) => {
                debouncedOptimizeAiChatLayout();
            });

            observer.observe(aiChatHistory, {
                childList: true,
                subtree: true,
                attributes: true,
                characterData: true
            });
        }
    }

    // 调整侧边栏高度
    function adjustSidebarHeight() {
        const sidebar = document.querySelector('.sidebar');
        const projectHeader = document.querySelector('.project-header');

        if (sidebar && projectHeader) {
            const headerHeight = projectHeader.offsetHeight;
            const availableHeight = window.innerHeight - headerHeight;
            sidebar.style.height = `${availableHeight}px`;
            sidebar.style.maxHeight = `${availableHeight}px`;
        }
    }

    // 优化AI聊天布局，确保输入框始终可见
    let lastLayoutHeight = 0;
    function optimizeAiChatLayout() {
        const aiContent = document.querySelector('.ai-content');
        const aiChatHistory = document.querySelector('.ai-chat-history');
        const aiInputContainer = document.querySelector('.ai-input-container');

        if (!aiContent || !aiChatHistory || !aiInputContainer) {
            return;
        }

        // 计算可用空间
        const contentRect = aiContent.getBoundingClientRect();
        const availableHeight = contentRect.height;

        // 如果高度没有变化，不需要重新计算布局
        if (Math.abs(availableHeight - lastLayoutHeight) < 2) {
            return;
        }
        lastLayoutHeight = availableHeight;

        // 计算固定元素的高度
        const quickActions = aiContent.querySelector('.quick-actions');
        const quickActionsHeight = quickActions ? quickActions.offsetHeight + 15 : 0; // margin-bottom
        const inputContainerHeight = aiInputContainer.offsetHeight;

        // 计算聊天历史可用的最大高度
        const maxChatHistoryHeight = availableHeight - quickActionsHeight - inputContainerHeight - 24; // padding

        // 动态调整聊天历史高度，确保不会太小
        if (maxChatHistoryHeight > 100) {
            const newHeight = Math.min(maxChatHistoryHeight, window.innerHeight * 0.4);
            const currentHeight = parseInt(aiChatHistory.style.height) || 0;

            // 只在高度变化超过5px时才更新样式，避免不必要的重排
            if (Math.abs(newHeight - currentHeight) > 5) {
                aiChatHistory.style.maxHeight = `${maxChatHistoryHeight}px`;
                aiChatHistory.style.height = `${newHeight}px`;
            }
        } else {
            // 如果高度太小，设置一个最小高度
            aiChatHistory.style.maxHeight = '200px';
            aiChatHistory.style.height = '150px';
        }

        // 确保输入框可见
        aiInputContainer.style.position = 'relative';
        aiInputContainer.style.zIndex = '10';
        aiInputContainer.style.display = 'flex';
        aiInputContainer.style.visibility = 'visible';

        // 自动滚动到最新消息 - 只在聊天历史有内容时
        if (aiChatHistory.children.length > 0) {
            requestAnimationFrame(() => {
                aiChatHistory.scrollTop = aiChatHistory.scrollHeight;
            });
        }
    }

    // 全局函数
    window.openProject = openProject;
    window.deleteProject = deleteProject;

    // 启动应用
    init();
});