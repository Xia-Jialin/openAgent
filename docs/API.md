# OpenAgent API 文档

## 概述

OpenAgent 是一个基于 Go 的 AI 智能体系统，提供 Web 界面与支持工具调用的 AI 模型进行交互。该系统支持多个 AI 模型提供商（OpenAI 兼容 API），并实现了工具调用架构，包含内置工具和 MCP（Model Context Protocol）服务器工具。

**基础信息**
- 服务器地址: `http://localhost:8081`
- API 版本: v1
- 认证方式: 无（开发环境）
- 响应格式: JSON

## 接口列表

### 1. 获取主页
**GET /**

获取系统主页 HTML 文件。

**响应**
- 状态码: 200
- 内容类型: text/html
- 响应体: index.html 文件内容

### 2. 静态文件服务
**GET /static/{filepath}**

提供静态资源文件服务（CSS、JavaScript 等）。

**参数**
- `filepath` (路径): 静态文件路径

**响应**
- 状态码: 200
- 内容类型: 根据文件类型
- 响应体: 文件内容

### 3. 获取会话列表
**GET /sessions**

获取当前所有活跃会话的 ID 列表。

**响应示例**
```json
[
  "550e8400-e29b-41d4-a716-446655440000",
  "550e8400-e29b-41d4-a716-446655440001"
]
```

**错误响应**
- 状态码: 500 - 服务器内部错误

### 4. 获取会话历史
**GET /chat/history**

获取指定会话的聊天历史记录。

**查询参数**
- `session_id` (字符串, 必需): 会话 ID

**响应示例**
```json
[
  {
    "role": "system",
    "content": "You are OpenManus, an all-capable AI assistant..."
  },
  {
    "role": "user",
    "content": "Hello, how are you?"
  },
  {
    "role": "assistant",
    "content": "I'm doing well! How can I help you today?"
  }
]
```

**错误响应**
- 状态码: 400 - session_id 参数缺失
  ```json
  {
    "error": "session_id is required"
  }
  ```
- 状态码: 404 - 会话不存在
  ```json
  {
    "error": "session not found"
  }
  ```

### 5. 聊天对话
**POST /chat**

处理用户聊天请求，支持流式响应和工具调用。

**请求体**
```json
{
  "content": "用户消息内容",
  "session_id": "会话ID（可选，不提供则创建新会话）"
}
```

**字段说明**
- `content` (字符串, 必需): 用户输入的消息内容
- `session_id` (字符串, 可选): 现有会话的 ID。如果不提供或会话不存在，将创建新会话

**响应格式**
使用 Server-Sent Events (SSE) 流式响应：

**响应头**
```
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive
Access-Control-Allow-Origin: *
```

**事件类型**

#### message 事件
```json
{
  "event": "message",
  "data": {
    "role": "assistant",
    "content": "AI 响应内容片段",
    "tool_calls": [
      {
        "id": "call_123",
        "type": "function",
        "function": {
          "name": "list_files",
          "arguments": "{\"path\":\".\"}"
        }
      }
    ]
  },
  "session_id": "新会话ID（仅在第一条消息中返回）"
}
```

#### tool 事件（工具调用结果）
```json
{
  "event": "message",
  "data": {
    "role": "tool",
    "content": "{\"success\":true,\"result\":[\"file1.txt\",\"file2.txt\"]}",
    "tool_call_id": "call_123"
  }
}
```

#### error 事件
```json
{
  "event": "error",
  "data": {
    "error": "错误信息描述"
  }
}
```

#### 流结束事件
```json
{
  "event": "message",
  "data": {
    "is_end": true
  }
}
```

**错误响应**
- 状态码: 400 - 请求格式错误
  - 当请求格式无效时，服务器会返回一个空的 SSE 流并以 `is_end: true` 结束
  - 示例结束事件:
    ```
    event: message
    data: {"is_end": true}
    ```
- 状态码: 500 - 创建新会话失败
  ```json
  {
    "error": "failed to create new session"
  }
  ```

## 数据模型

### Message 对象
```json
{
  "role": "system|user|assistant|tool",
  "content": "消息内容",
  "tool_calls": [
    {
      "id": "工具调用ID",
      "type": "function",
      "function": {
        "name": "工具名称",
        "arguments": "JSON格式的参数字符串"
      }
    }
  ],
  "tool_call_id": "关联的工具调用ID（仅在工具响应时存在）"
}
```

### 角色类型
- `system`: 系统提示消息
- `user`: 用户消息
- `assistant`: AI 助手响应
- `tool`: 工具执行结果

## 功能特性

### 会话管理
- 每个会话具有独立的 ID 和工作目录
- 会话数据存储在内存中，服务器重启后丢失
- 支持多会话并发处理

### 工具系统
支持的工具类型：
- **内置工具**:
  - `delete_file`: 删除文件
  - `list_files`: 列出目录文件
  - `write_file`: 写入文件
  - `read_file`: 读取文件
- **MCP 工具**: 通过配置的 MCP 服务器动态加载

### 工作目录隔离
- 每个会话在 `workspace/{session_id}/` 下有独立的工作空间
- 文件操作工具默认在会话工作目录中执行
- 支持相对路径操作

### 流式响应
- 使用 Server-Sent Events (SSE) 实现实时对话
- 支持工具调用结果的实时流式传输
- 自动处理工具调用链

## 使用示例

### 创建新会话并发送消息
```bash
curl -X POST http://localhost:8081/chat \
  -H "Content-Type: application/json" \
  -d '{
    "content": "请列出当前目录的文件"
  }'
```

### 继续现有会话
```bash
curl -X POST http://localhost:8081/chat \
  -H "Content-Type: application/json" \
  -d '{
    "content": "请创建一个新文件",
    "session_id": "550e8400-e29b-41d4-a716-446655440000"
  }'
```

### 获取会话历史
```bash
curl "http://localhost:8081/chat/history?session_id=550e8400-e29b-41d4-a716-446655440000"
```

### 获取所有会话
```bash
curl http://localhost:8081/sessions
```

## 错误处理

### 常见错误码
- 400: 请求参数错误或格式错误
- 404: 会话不存在
- 500: 服务器内部错误

### 错误响应格式

#### 标准 JSON 错误响应
```json
{
  "error": "错误描述信息"
}
```

#### SSE 流错误响应
```
event: error
data: {"error": "错误信息描述"}
```

#### 工具执行错误
```json
{
  "role": "tool",
  "content": "{\"success\": false, \"message\": \"工具执行失败的具体原因\"}",
  "tool_call_id": "工具调用ID"
}
```

### 异常处理能力

#### 网络异常
- ✅ 连接超时处理
- ✅ 不匹配的 Content-Length 头部处理
- ✅ 网络中断恢复

#### 数据异常
- ✅ JSON 格式验证
- ✅ 空值和 null 值处理
- ✅ 超长内容处理 (支持 10K+ 字符)
- ⚠️ 特殊字符处理 (需要转义)

#### 业务异常
- ✅ 工具执行失败处理
- ✅ 路径遍历攻击防护
- ✅ 会话不存在处理
- ✅ 参数验证

#### 并发处理
- ✅ 多会话并发创建
- ✅ 无竞态条件
- ✅ 会话隔离

#### 安全防护
- ✅ 工作目录路径隔离
- ✅ 输入长度限制
- ✅ 路径遍历防护
- ✅ 错误信息安全 (不泄露敏感信息)

## 环境配置

### 必需的环境变量
- `OPENAI_API_KEY`: AI 模型提供商的 API 密钥
- `OPENAI_MODEL_NAME`: 使用的模型名称（如 "deepseek-chat", "gpt-4"）

### 可选的环境变量
- `OPENAI_BASE_URL`: API 基础 URL（用于自定义 API 端点）

## 注意事项

1. **会话持久化**: 当前会话数据仅存储在内存中，服务器重启后会话将丢失
2. **文件路径**: 工具调用中的文件路径应为相对于会话工作目录的路径
3. **并发限制**: 支持多会话并发，但单个会话内的消息是顺序处理的
4. **工具调用**: 工具调用可能会多次执行，直到 AI 模型确定任务完成
5. **流式连接**: SSE 连接在长时间无活动后可能会自动断开