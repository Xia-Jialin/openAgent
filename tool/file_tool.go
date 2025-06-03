package tool

import (
	"context"
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
	absPath, err := filepath.Abs(input.FilePath)
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
