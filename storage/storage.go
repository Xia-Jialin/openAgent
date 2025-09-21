package storage

import (
	"database/sql"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"time"

	"github.com/cloudwego/eino/schema"
	_ "github.com/mattn/go-sqlite3"
)

type Session struct {
	ID          string    `json:"id"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
	WorkDir     string    `json:"work_dir"`
	SystemPrompt string   `json:"system_prompt"`
	Title       string    `json:"title"`
}

type Message struct {
	ID        int64     `json:"id"`
	SessionID string    `json:"session_id"`
	Role      string    `json:"role"`
	Content   string    `json:"content"`
	CreatedAt time.Time `json:"created_at"`
	ToolCallID string   `json:"tool_call_id,omitempty"`
}

type Storage struct {
	db        *sql.DB
	dbPathStr string
}

func NewStorage(dbPath string) (*Storage, error) {
	if err := os.MkdirAll(filepath.Dir(dbPath), 0755); err != nil {
		return nil, fmt.Errorf("failed to create database directory: %w", err)
	}

	db, err := sql.Open("sqlite3", dbPath)
	if err != nil {
		return nil, fmt.Errorf("failed to open database: %w", err)
	}

	if err := db.Ping(); err != nil {
		return nil, fmt.Errorf("failed to ping database: %w", err)
	}

	storage := &Storage{db: db, dbPathStr: dbPath}
	if err := storage.initSchema(); err != nil {
		db.Close()
		return nil, fmt.Errorf("failed to initialize schema: %w", err)
	}

	return storage, nil
}

func (s *Storage) initSchema() error {
	schemaSQL := `
	CREATE TABLE IF NOT EXISTS sessions (
		id TEXT PRIMARY KEY,
		created_at DATETIME NOT NULL,
		updated_at DATETIME NOT NULL,
		work_dir TEXT NOT NULL,
		system_prompt TEXT NOT NULL,
		title TEXT NOT NULL
	);

	CREATE TABLE IF NOT EXISTS messages (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		session_id TEXT NOT NULL,
		role TEXT NOT NULL,
		content TEXT NOT NULL,
		tool_call_id TEXT,
		created_at DATETIME NOT NULL,
		FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
	);

	CREATE INDEX IF NOT EXISTS idx_messages_session_id ON messages(session_id);
	CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at);
	`

	if _, err := s.db.Exec(schemaSQL); err != nil {
		return fmt.Errorf("failed to create tables: %w", err)
	}

	return nil
}

func (s *Storage) CreateSession(sessionID, workDir, systemPrompt, title string) error {
	now := time.Now()
	query := `
		INSERT INTO sessions (id, created_at, updated_at, work_dir, system_prompt, title)
		VALUES (?, ?, ?, ?, ?, ?)
	`
	_, err := s.db.Exec(query, sessionID, now, now, workDir, systemPrompt, title)
	return err
}

func (s *Storage) GetSession(sessionID string) (*Session, error) {
	query := `
		SELECT id, created_at, updated_at, work_dir, system_prompt, title
		FROM sessions WHERE id = ?
	`
	row := s.db.QueryRow(query, sessionID)

	var session Session
	err := row.Scan(&session.ID, &session.CreatedAt, &session.UpdatedAt, &session.WorkDir, &session.SystemPrompt, &session.Title)
	if err != nil {
		return nil, err
	}

	return &session, nil
}

func (s *Storage) UpdateSession(sessionID string, title string) error {
	now := time.Now()
	query := `
		UPDATE sessions SET updated_at = ?, title = ? WHERE id = ?
	`
	_, err := s.db.Exec(query, now, title, sessionID)
	return err
}

func (s *Storage) GetAllSessions() ([]*Session, error) {
	query := `
		SELECT id, created_at, updated_at, work_dir, system_prompt, title
		FROM sessions ORDER BY updated_at DESC
	`
	rows, err := s.db.Query(query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var sessions []*Session
	for rows.Next() {
		var session Session
		if err := rows.Scan(&session.ID, &session.CreatedAt, &session.UpdatedAt, &session.WorkDir, &session.SystemPrompt, &session.Title); err != nil {
			return nil, err
		}
		sessions = append(sessions, &session)
	}

	return sessions, nil
}

func (s *Storage) DeleteSession(sessionID string) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if _, err := tx.Exec("DELETE FROM messages WHERE session_id = ?", sessionID); err != nil {
		return err
	}

	if _, err := tx.Exec("DELETE FROM sessions WHERE id = ?", sessionID); err != nil {
		return err
	}

	return tx.Commit()
}

func (s *Storage) SaveMessage(sessionID string, message *schema.Message) error {
	content := message.Content
	var toolCallID string

	if message.Role == schema.Tool {
		toolCallID = message.ToolCallID
	}

	query := `
		INSERT INTO messages (session_id, role, content, tool_call_id, created_at)
		VALUES (?, ?, ?, ?, ?)
	`
	_, err := s.db.Exec(query, sessionID, message.Role, content, toolCallID, time.Now())
	return err
}

func (s *Storage) GetMessages(sessionID string) ([]*schema.Message, error) {
	query := `
		SELECT role, content, tool_call_id
		FROM messages WHERE session_id = ?
		ORDER BY created_at ASC
	`
	rows, err := s.db.Query(query, sessionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var messages []*schema.Message
	for rows.Next() {
		var role, content, toolCallID string
		if err := rows.Scan(&role, &content, &toolCallID); err != nil {
			return nil, err
		}

		message := &schema.Message{
			Role:    schema.RoleType(role),
			Content: content,
		}

		if schema.RoleType(role) == schema.Tool && toolCallID != "" {
			message.ToolCallID = toolCallID
		}

		messages = append(messages, message)
	}

	return messages, nil
}

func (s *Storage) GetHistory(sessionID string) []*schema.Message {
	messages, err := s.GetMessages(sessionID)
	if err != nil {
		log.Printf("Failed to get messages for session %s: %v", sessionID, err)
		return nil
	}

	return messages
}

func (s *Storage) ClearMessages(sessionID string) error {
	query := "DELETE FROM messages WHERE session_id = ?"
	_, err := s.db.Exec(query, sessionID)
	return err
}

func (s *Storage) Close() error {
	if s.db != nil {
		return s.db.Close()
	}
	return nil
}

func (s *Storage) GetDBStats() (map[string]interface{}, error) {
	stats := make(map[string]interface{})

	var sessionCount int
	err := s.db.QueryRow("SELECT COUNT(*) FROM sessions").Scan(&sessionCount)
	if err != nil {
		return nil, err
	}
	stats["sessions"] = sessionCount

	var messageCount int
	err = s.db.QueryRow("SELECT COUNT(*) FROM messages").Scan(&messageCount)
	if err != nil {
		return nil, err
	}
	stats["messages"] = messageCount

	var dbSize int64
	err = s.db.QueryRow("SELECT page_count * page_size FROM pragma_page_count(), pragma_page_size()").Scan(&dbSize)
	if err != nil {
		return nil, err
	}
	stats["db_size_bytes"] = dbSize

	return stats, nil
}

func (s *Storage) Backup(backupPath string) error {
	source, err := os.ReadFile(s.dbPath())
	if err != nil {
		return fmt.Errorf("failed to read source database: %w", err)
	}

	if err := os.WriteFile(backupPath, source, 0644); err != nil {
		return fmt.Errorf("failed to write backup: %w", err)
	}

	return nil
}

func (s *Storage) dbPath() string {
	return s.dbPathStr
}