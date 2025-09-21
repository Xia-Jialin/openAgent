# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

OpenAgent is a Go-based AI agent system that provides a web interface for interacting with AI models equipped with various tools. The project supports multiple AI model providers (OpenAI-compatible APIs) and implements a tool-calling architecture with both built-in and MCP (Model Context Protocol) server tools.

## Key Commands

### Building and Running
```bash
# Run the development server
go run main.go

# Build the project
go build -o openAgent main.go

# Install dependencies
go mod tidy
go mod download
```

### Development Commands
```bash
# Format code
go fmt ./...

# Run tests (if any)
go test ./...

# Check for issues
go vet ./...

# Build with specific flags
go run -ldflags="-X 'main.Version=dev'" main.go
```

## Architecture

### Core Components

1. **Main Application** (`main.go`):
   - HTTP server using Gin framework
   - Session management for multi-user support
   - MCP server initialization and tool aggregation
   - SSE (Server-Sent Events) for streaming responses

2. **Agent System** (`agent/agent.go`):
   - Defines the `Agent` interface with `Run()` and `StreamRun()` methods
   - Implements `coderAgent` that handles tool calls and conversation history
   - Manages workspace isolation per session
   - Processes both streaming and non-streaming model responses

3. **Tool System** (`tool/file_tool.go`):
   - Built-in file operation tools: `delete_file`, `list_files`, `write_file`, `read_file`
   - Workspace-aware path resolution using context values
   - Error handling and structured JSON responses

4. **Web Interface** (`web/`):
   - Frontend HTML, CSS, and JavaScript files
   - Real-time chat interface with SSE support
   - Session management and history display

### MCP Integration

The project integrates MCP servers defined in `mcp.json`:
- **context7**: Upstash Context7 MCP server for context management
- **playwright**: Browser automation via Playwright MCP

MCP tools are dynamically loaded and combined with built-in tools to provide a comprehensive toolset.

### Configuration

**Environment Variables** (`.env` file):
- `OPENAI_API_KEY`: API key for the AI model provider
- `OPENAI_MODEL_NAME`: Model name to use (e.g., "deepseek-chat", "gpt-4")
- `OPENAI_BASE_URL`: Base URL for API requests (optional)

**MCP Configuration** (`mcp.json`):
- Defines MCP servers with their command and arguments
- Supports multiple concurrent MCP servers

### Session Management

- Each session gets a unique workspace directory in `workspace/{session_id}/`
- Sessions are isolated with their own agent instances and workspaces
- Conversation history is maintained per session
- Supports both new session creation and existing session resumption

### Tool Execution Flow

1. User sends message via HTTP POST to `/chat`
2. Agent processes message and calls AI model
3. If model requests tool calls, agent executes them:
   - Built-in tools: File operations in session workspace
   - MCP tools: Delegated to respective MCP servers
4. Tool results are sent back to model
5. Final response is streamed to client via SSE

## File Structure

```
openAgent/
├── main.go              # Main application entry point
├── go.mod               # Go module definition
├── go.sum               # Dependency checksums
├── .env                 # Environment variables (template)
├── mcp.json             # MCP server configuration
├── agent/
│   └── agent.go         # Agent interface and implementation
├── tool/
│   └── file_tool.go     # Built-in file operation tools
├── web/
│   ├── index.html       # Main web interface
│   └── static/          # CSS and JavaScript files
├── workspace/           # Session workspaces (created at runtime)
└── vendor/              # Go dependencies
```

## Development Notes

- The project uses Go 1.24.1
- Dependencies are managed through Go modules
- The web server runs on port 8081 by default
- Each session has isolated workspace directories
- Tool calls are executed with proper error handling and JSON responses
- The system supports both streaming and non-streaming AI model interactions

## Environment Setup

1. Copy `.env` file and set your API credentials
2. Configure MCP servers in `mcp.json` if needed
3. Run `go mod tidy` to ensure dependencies are installed
4. Start the server with `go run main.go`
5. Access the web interface at `http://localhost:8081`