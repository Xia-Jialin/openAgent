# OpenAgent

OpenAgent 是一个基于 Go 的 AI 智能体系统，提供 Web 界面用于与配备各种工具的 AI 模型交互。该项目支持多个 AI 模型提供商（兼容 OpenAI API），并实现了具有内置工具和 MCP（模型上下文协议）服务器工具的工具调用架构。

## 特性

- 🤖 **AI 智能体界面**：基于 Web 的聊天界面，与 AI 模型交互
- 🔧 **工具集成**：内置文件操作工具和 MCP 服务器集成
- 🌐 **多模型支持**：兼容 OpenAI API 提供商（DeepSeek、GPT-4 等）
- 📁 **工作区管理**：每个会话的隔离工作区用于文件操作
- 🔄 **实时流式传输**：服务器发送事件（SSE）用于流式响应
- 🎭 **WebSocket 支持**：实时 HTML 预览功能
- 📊 **会话管理**：持久化会话处理和对话历史记录

## 快速开始

### 环境要求

- Go 1.24.1 或更高版本
- Node.js（用于 MCP 服务器）
- AI 模型提供商的 API 密钥

### 安装

1. 克隆仓库：
```bash
git clone <repository-url>
cd openAgent
```

2. 安装 Go 依赖：
```bash
go mod tidy
go mod download
```

3. 配置环境变量：
```bash
cp .env.example .env
# 使用您的 API 凭据编辑 .env 文件
```

4. 运行开发服务器：
```bash
go run main.go
```

5. 在浏览器中打开 `http://localhost:8081`

## 配置

### 环境变量

在项目根目录创建 `.env` 文件：

```env
OPENAI_API_KEY=your_api_key_here
OPENAI_MODEL_NAME=deepseek-chat
OPENAI_BASE_URL=https://api.deepseek.com
```

### MCP 配置

编辑 `mcp.json` 配置 MCP 服务器：

```json
{
  "mcpServers": {
    "context7": {
      "command": "npx",
      "args": ["-y", "@upstash/context7-mcp@latest"]
    },
    "playwright": {
      "command": "npx",
      "args": ["@playwright/mcp@latest"]
    }
  }
}
```

## 项目结构

```
openAgent/
├── main.go              # 主应用程序入口
├── go.mod               # Go 模块定义
├── go.sum               # 依赖校验和
├── .env                 # 环境变量
├── mcp.json             # MCP 服务器配置
├── agent/
│   └── agent.go         # 智能体接口和实现
├── tool/
│   └── file_tool.go     # 内置文件操作工具
├── web/
│   ├── index.html       # 主 Web 界面
│   └── static/          # CSS 和 JavaScript 文件
├── storage/
│   └── storage.go       # 数据库存储实现
├── workspace/           # 会话工作区（运行时创建）
└── vendor/              # Go 依赖
```

## 内置工具

系统包含以下内置文件操作工具：

- **`delete_file`**：删除会话工作区中的文件
- **`list_files`**：列出会话工作区中的文件
- **`write_file`**：向会话工作区中的文件写入内容
- **`read_file`**：读取会话工作区中的文件内容

## MCP 集成

OpenAgent 与 MCP（模型上下文协议）服务器集成以扩展功能：

- **Context7**：Upstash Context7 用于上下文管理
- **Playwright**：浏览器自动化功能

MCP 工具被动态加载并与内置工具结合使用。

## 架构

### 核心组件

1. **HTTP 服务器**：基于 Gin 的 Web 服务器，处理 API 路由
2. **智能体系统**：管理 AI 模型交互和工具执行
3. **工具系统**：执行内置和 MCP 工具
4. **会话管理**：每个会话的隔离工作区
5. **流式传输**：通过 SSE 实现实时响应流式传输

### API 端点

- `GET /`：主 Web 界面
- `POST /chat`：向 AI 智能体发送消息
- `GET /history`：获取对话历史记录
- `POST /clear`：清除对话历史记录
- `GET /preview`：HTML 预览的 WebSocket 端点

## 开发

### 构建命令

```bash
# 运行开发服务器
go run main.go

# 构建项目
go build -o openAgent main.go

# 格式化代码
go fmt ./...

# 运行测试
go test ./...

# 检查问题
go vet ./...
```

### 自定义版本构建

```bash
go run -ldflags="-X 'main.Version=1.0.0'" main.go
```

## 使用示例

### 基本聊天交互

1. 在 `http://localhost:8081` 打开 Web 界面
2. 开始新会话或恢复现有会话
3. 向 AI 智能体发送消息
4. 智能体可以使用工具在您的工作区中创建、读取和修改文件

### 文件操作

AI 智能体可以在会话工作区中执行文件操作：

```
创建一个具有基本结构的新 HTML 文件
```

智能体将使用 `write_file` 工具在会话工作区中创建文件。

### 实时预览

创建 HTML 文件时，系统通过 WebSocket 提供实时预览：

1. 智能体创建 HTML 文件
2. 文件自动在预览窗格中打开
3. 文件的更改会实时反映

## 故障排除

### 常见问题

1. **端口已被占用**：服务器默认在端口 8081 上运行。确保此端口可用。
2. **API 密钥问题**：验证您的 API 密钥在 `.env` 文件中正确设置。
3. **MCP 服务器问题**：确保已安装 Node.js 且可以下载 MCP 服务器。

### 调试模式

使用调试日志运行服务器：

```bash
go run -ldflags="-X 'main.Debug=true'" main.go
```

## 许可证

本项目基于 MIT 许可证。

## 贡献

1. 分叉仓库
2. 创建功能分支
3. 进行更改
4. 如适用，添加测试
5. 提交拉取请求

## 支持

如有问题和疑问，请在仓库中创建 issue。