-- Comments Collator Database Schema
-- SQLite database for storing Figma comments and user data

-- Users table for OAuth authentication
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    figma_user_id TEXT UNIQUE NOT NULL,
    email TEXT,
    name TEXT,
    handle TEXT,
    avatar_url TEXT,
    access_token TEXT NOT NULL,
    refresh_token TEXT,
    token_expires_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Files table for tracking Figma files
CREATE TABLE IF NOT EXISTS files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    figma_file_key TEXT UNIQUE NOT NULL,
    file_name TEXT,
    team_id TEXT,
    owner_user_id INTEGER,
    webhook_id TEXT,
    last_synced_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (owner_user_id) REFERENCES users (id) ON DELETE SET NULL
);

-- Comments table for storing Figma comments
CREATE TABLE IF NOT EXISTS comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    figma_comment_id TEXT UNIQUE NOT NULL,
    figma_file_key TEXT NOT NULL,
    node_id TEXT,
    node_name TEXT,
    message TEXT NOT NULL,
    author_id INTEGER,
    author_name TEXT,
    author_handle TEXT,
    parent_comment_id TEXT,
    resolved_at DATETIME,
    resolved_by_id INTEGER,
    position_x REAL DEFAULT 0,
    position_y REAL DEFAULT 0,
    figma_created_at DATETIME NOT NULL,
    figma_updated_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (author_id) REFERENCES users (id) ON DELETE SET NULL,
    FOREIGN KEY (resolved_by_id) REFERENCES users (id) ON DELETE SET NULL,
    FOREIGN KEY (figma_file_key) REFERENCES files (figma_file_key) ON DELETE CASCADE
);

-- Webhook events table for tracking webhook deliveries
CREATE TABLE IF NOT EXISTS webhook_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_type TEXT NOT NULL,
    figma_file_key TEXT,
    event_data TEXT, -- JSON string
    processed_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (figma_file_key) REFERENCES files (figma_file_key) ON DELETE SET NULL
);

-- File permissions table for access control
CREATE TABLE IF NOT EXISTS file_permissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    figma_file_key TEXT NOT NULL,
    permission_level TEXT NOT NULL DEFAULT 'read', -- 'read', 'write', 'admin'
    granted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    granted_by_id INTEGER,
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
    FOREIGN KEY (figma_file_key) REFERENCES files (figma_file_key) ON DELETE CASCADE,
    FOREIGN KEY (granted_by_id) REFERENCES users (id) ON DELETE SET NULL,
    UNIQUE(user_id, figma_file_key)
);

-- Plugin sessions table for tracking plugin usage
CREATE TABLE IF NOT EXISTS plugin_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    figma_file_key TEXT,
    session_token TEXT UNIQUE NOT NULL,
    node_id TEXT,
    last_activity_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
    FOREIGN KEY (figma_file_key) REFERENCES files (figma_file_key) ON DELETE CASCADE
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_comments_file_key ON comments (figma_file_key);
CREATE INDEX IF NOT EXISTS idx_comments_node_id ON comments (node_id);
CREATE INDEX IF NOT EXISTS idx_comments_author_id ON comments (author_id);
CREATE INDEX IF NOT EXISTS idx_comments_created_at ON comments (figma_created_at);
CREATE INDEX IF NOT EXISTS idx_webhook_events_type ON webhook_events (event_type);
CREATE INDEX IF NOT EXISTS idx_webhook_events_file_key ON webhook_events (figma_file_key);
CREATE INDEX IF NOT EXISTS idx_file_permissions_user_file ON file_permissions (user_id, figma_file_key);
CREATE INDEX IF NOT EXISTS idx_plugin_sessions_user ON plugin_sessions (user_id);
CREATE INDEX IF NOT EXISTS idx_plugin_sessions_token ON plugin_sessions (session_token);

-- Triggers for updating timestamps
CREATE TRIGGER IF NOT EXISTS update_users_timestamp 
    AFTER UPDATE ON users
    BEGIN
        UPDATE users SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
    END;

CREATE TRIGGER IF NOT EXISTS update_files_timestamp 
    AFTER UPDATE ON files
    BEGIN
        UPDATE files SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
    END;

CREATE TRIGGER IF NOT EXISTS update_comments_timestamp 
    AFTER UPDATE ON comments
    BEGIN
        UPDATE comments SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
    END; 