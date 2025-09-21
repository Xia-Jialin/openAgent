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
        aiChatHistory: []
    };

    // 初始化应用
    async function init() {
        await loadProjects();
        setupEventListeners();
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
            const response = await fetch(`/chat/history?session_id=${projectId}`);
            const history = await response.json();

            // 解析文件结构
            state.files = parseFileStructure(history);
            renderFileTree();
        } catch (error) {
            console.error('Failed to load project files:', error);
        }
    }

    // 解析文件结构
    function parseFileStructure(history) {
        const files = [];
        // 这里应该根据历史记录解析文件结构
        // 现在先返回一个示例结构
        return [
            {
                name: 'src',
                type: 'folder',
                children: [
                    { name: 'App.jsx', type: 'file', content: '// React App Component' },
                    { name: 'Header.jsx', type: 'file', content: '// Header Component' },
                    { name: 'index.css', type: 'file', content: '// CSS Styles' }
                ]
            },
            {
                name: 'public',
                type: 'folder',
                children: [
                    { name: 'index.html', type: 'file', content: '<!DOCTYPE html>' }
                ]
            },
            { name: 'package.json', type: 'file', content: '{\n  "name": "project"\n}' }
        ];
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
    function openFile(file) {
        state.currentFile = file;
        elements.currentFileName.textContent = `📄 ${file.name}`;
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
            if (e.key === 'Enter') sendAiMessage();
        });
        elements.clearChatBtn.addEventListener('click', clearAiChat);

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

        try {
            // 创建新会话
            const response = await fetch('/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ content: description })
            });

            if (response.ok) {
                const reader = response.body.getReader();
                const decoder = new TextDecoder();

                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;

                    const chunk = decoder.decode(value);
                    const lines = chunk.split('\n');

                    for (const line of lines) {
                        if (line.startsWith('data:')) {
                            const data = line.substring(5).trim();
                            if (data) {
                                try {
                                    const eventData = JSON.parse(data);
                                    if (eventData.session_id) {
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
                                        break;
                                    }
                                } catch (e) {
                                    console.error('Error parsing SSE data:', e);
                                }
                            }
                        }
                    }
                }
            }
        } catch (error) {
            console.error('Error creating project:', error);
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

    // 发送AI消息
    async function sendAiMessage() {
        const message = elements.aiInput.value.trim();
        if (!message || !state.currentProject) return;

        addAiMessage('user', message);
        elements.aiInput.value = '';

        try {
            const response = await fetch('/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    content: message,
                    session_id: state.currentProject
                })
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            // 处理流式响应
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let aiResponse = '';
            let isFirstMessage = true;

            while (true) {
                const { done, value } = await reader.read();
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
                                    continue;
                                }

                                const msgData = eventData.data;
                                if (msgData) {
                                    const msg = JSON.parse(msgData);

                                    if (msg.role === 'tool') {
                                        // 处理工具调用结果
                                        const toolResult = JSON.parse(msg.content);
                                        addToolMessage(toolResult);
                                    } else if (msg.content) {
                                        // 处理普通消息
                                        aiResponse += msg.content;
                                        updateLastAiMessage(aiResponse);
                                    }
                                }
                            } catch (e) {
                                console.error('Error parsing SSE data:', e, 'data:', data);
                            }
                        }
                    }
                }
            }
        } catch (error) {
            console.error('Error sending AI message:', error);
            addAiMessage('system', '发送消息时出错，请稍后重试。');
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
    }

    // 更新最后一条AI消息
    function updateLastAiMessage(content) {
        const lastMessage = elements.aiChatHistory.lastElementChild;
        if (lastMessage && lastMessage.querySelector('.ai-role.ai')) {
            lastMessage.lastElementChild.textContent = content;
            elements.aiChatHistory.scrollTop = elements.aiChatHistory.scrollHeight;
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
    function refreshPreview() {
        // 这里应该更新iframe的内容
        // 现在先显示一个简单的HTML页面
        const htmlContent = generatePreviewHtml();
        elements.previewIframe.srcdoc = htmlContent;
    }

    // 生成预览HTML
    function generatePreviewHtml() {
        return `
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="UTF-8">
                <title>预览 - ${state.currentProject || '项目'}</title>
                <style>
                    body { font-family: Arial, sans-serif; margin: 20px; }
                    .preview-header { background: #007acc; color: white; padding: 20px; border-radius: 8px; margin-bottom: 20px; }
                    .preview-content { background: #f8f9fa; padding: 20px; border-radius: 8px; }
                </style>
            </head>
            <body>
                <div class="preview-header">
                    <h1>${state.currentProject || '项目预览'}</h1>
                    <p>这是项目的实时预览</p>
                </div>
                <div class="preview-content">
                    <h2>项目内容</h2>
                    <p>这里显示项目的实际渲染结果。</p>
                    <div id="app"></div>
                </div>
                <script>
                    // 这里可以插入生成的JavaScript代码
                    console.log('Preview loaded');
                </script>
            </body>
            </html>
        `;
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
                                }, 50);
                            }
                        }
                    });
                });

                observer.observe(view, { attributes: true });
            }
        });
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

    // 全局函数
    window.openProject = openProject;

    // 启动应用
    init();
});