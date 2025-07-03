package tool

import (
	"context"
	"openAgent/agent"
	"os"
	"path/filepath"

	"github.com/cloudwego/eino/components/tool"
	"github.com/cloudwego/eino/components/tool/utils"
)

type DeleteFileInput struct {
	FilePath string `json:"file_path" jsonschema:"required,description=要删除的文件路径"`
}

type DeleteFileResult struct {
	Success bool   `json:"success"`
	Message string `json:"message"`
}

func deleteFile(ctx context.Context, input *DeleteFileInput) (*DeleteFileResult, error) {
	// 转化为绝对路径
	path := input.FilePath
	workDir, ok := ctx.Value(agent.WorkDirKey).(string)
	if ok && !filepath.IsAbs(path) {
		path = filepath.Join(workDir, path)
	}

	absPath, err := filepath.Abs(path)
	if err != nil {
		return &DeleteFileResult{
			Success: false,
			Message: err.Error(),
		}, nil
	}
	err = os.Remove(absPath)
	if err != nil {
		return &DeleteFileResult{
			Success: false,
			Message: err.Error(),
		}, nil
	}
	return &DeleteFileResult{
		Success: true,
		Message: "文件删除成功",
	}, nil
}

func NewDeleteFileTool() (tool.InvokableTool, error) {
	return utils.InferTool("delete_file", "删除指定路径的文件", deleteFile)
}

// --- ListFiles Tool ---

type ListFilesInput struct {
	DirectoryPath string `json:"directory_path" jsonschema:"description=要列出文件的目录路径,default=."`
}

type ListFilesResult struct {
	Entries []string `json:"entries"`
}

func listFiles(ctx context.Context, input *ListFilesInput) (*ListFilesResult, error) {
	workDir, ok := ctx.Value(agent.WorkDirKey).(string)
	if !ok {
		// 如果上下文中没有 workDir，则使用当前工作目录
		cwd, err := os.Getwd()
		if err != nil {
			return nil, err
		}
		workDir = cwd
	}

	dirPath := input.DirectoryPath
	if dirPath == "" {
		dirPath = "."
	}

	absPath := filepath.Join(workDir, dirPath)

	entries, err := os.ReadDir(absPath)
	if err != nil {
		return nil, err
	}

	fileList := make([]string, 0)
	for _, e := range entries {
		entryName := e.Name()
		if e.IsDir() {
			entryName += "/"
		}
		fileList = append(fileList, entryName)
	}

	return &ListFilesResult{Entries: fileList}, nil
}

func NewListFilesTool() (tool.InvokableTool, error) {
	return utils.InferTool("list_files", "列出指定目录下的文件和子目录", listFiles)
}

// --- WriteFile Tool ---

type WriteFileInput struct {
	FilePath string `json:"file_path" jsonschema:"required,description=要写入的文件路径"`
	Content  string `json:"content" jsonschema:"required,description=要写入的文件内容"`
}

type WriteFileResult struct {
	Success bool   `json:"success"`
	Message string `json:"message"`
}

func writeFile(ctx context.Context, input *WriteFileInput) (*WriteFileResult, error) {
	workDir, ok := ctx.Value(agent.WorkDirKey).(string)
	if !ok {
		cwd, err := os.Getwd()
		if err != nil {
			return nil, err
		}
		workDir = cwd
	}

	path := filepath.Join(workDir, input.FilePath)

	// 确保目录存在
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		return &WriteFileResult{Success: false, Message: "创建目录失败: " + err.Error()}, nil
	}

	err := os.WriteFile(path, []byte(input.Content), 0644)
	if err != nil {
		return &WriteFileResult{Success: false, Message: err.Error()}, nil
	}
	return &WriteFileResult{Success: true, Message: "文件写入成功"}, nil
}

func NewWriteFileTool() (tool.InvokableTool, error) {
	return utils.InferTool("write_file", "向指定文件写入内容。如果文件不存在，则会创建；如果文件已存在，则会覆盖。", writeFile)
}

// --- ReadFile Tool ---

type ReadFileInput struct {
	FilePath string `json:"file_path" jsonschema:"required,description=要读取的文件路径"`
}

type ReadFileResult struct {
	Content string `json:"content"`
}

func readFile(ctx context.Context, input *ReadFileInput) (*ReadFileResult, error) {
	workDir, ok := ctx.Value(agent.WorkDirKey).(string)
	if !ok {
		cwd, err := os.Getwd()
		if err != nil {
			return nil, err
		}
		workDir = cwd
	}

	path := filepath.Join(workDir, input.FilePath)

	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}

	return &ReadFileResult{Content: string(data)}, nil
}

func NewReadFileTool() (tool.InvokableTool, error) {
	return utils.InferTool("read_file", "读取指定文件的内容", readFile)
}
