const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

class DatabaseWrapper {
    constructor() {
        const dbPath = process.env.DATABASE_URL || './database/comments.db';
        
        // Ensure directory exists
        const dbDir = path.dirname(dbPath);
        try {
            if (!fs.existsSync(dbDir)) {
                fs.mkdirSync(dbDir, { recursive: true });
                console.log(`Created database directory: ${dbDir}`);
            }
        } catch (error) {
            console.log(`Could not create directory ${dbDir}, using file directly:`, error.message);
        }
        
        try {
            this.db = new Database(dbPath);
            console.log('Connected to SQLite database');
            
            // Enable foreign keys
            this.db.pragma('foreign_keys = ON');
        } catch (err) {
            console.error('Error opening database:', err);
            throw err;
        }
    }

    // Helper to run queries (synchronous with better-sqlite3)
    run(sql, params = []) {
        try {
            const stmt = this.db.prepare(sql);
            const result = stmt.run(params);
            return { id: result.lastInsertRowid, changes: result.changes };
        } catch (error) {
            console.error('Database run error:', error.message, 'SQL:', sql);
            throw error;
        }
    }

    get(sql, params = []) {
        try {
            const stmt = this.db.prepare(sql);
            return stmt.get(params);
        } catch (error) {
            console.error('Database get error:', error.message, 'SQL:', sql);
            throw error;
        }
    }

    all(sql, params = []) {
        try {
            const stmt = this.db.prepare(sql);
            return stmt.all(params);
        } catch (error) {
            console.error('Database all error:', error.message, 'SQL:', sql);
            throw error;
        }
    }

    // User operations
    async upsertUser(userData) {
        const sql = `
            INSERT INTO users (figma_user_id, email, name, handle, avatar_url, access_token, refresh_token, token_expires_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(figma_user_id) DO UPDATE SET
                email = excluded.email,
                name = excluded.name,
                handle = excluded.handle,
                avatar_url = excluded.avatar_url,
                access_token = excluded.access_token,
                refresh_token = excluded.refresh_token,
                token_expires_at = excluded.token_expires_at,
                updated_at = CURRENT_TIMESTAMP
        `;

        this.run(sql, [
            userData.figmaUserId,
            userData.email,
            userData.name,
            userData.handle,
            userData.avatarUrl,
            userData.accessToken,
            userData.refreshToken,
            userData.tokenExpiresAt
        ]);

        // Return the user record
        const user = this.get('SELECT * FROM users WHERE figma_user_id = ?', [userData.figmaUserId]);
        return user;
    }

    async getUserById(userId) {
        return this.get('SELECT * FROM users WHERE id = ?', [userId]);
    }

    async getUserByFigmaId(figmaUserId) {
        return this.get('SELECT * FROM users WHERE figma_user_id = ?', [figmaUserId]);
    }

    async getUserByHandle(handle) {
        return this.get('SELECT * FROM users WHERE handle = ?', [handle]);
    }

    async getAnyValidUser() {
        const sql = `
            SELECT * FROM users 
            WHERE access_token IS NOT NULL 
            AND (token_expires_at IS NULL OR token_expires_at > datetime('now'))
            ORDER BY updated_at DESC 
            LIMIT 1
        `;
        return this.get(sql);
    }

    async updateUserTokens(refreshToken, tokenData) {
        const sql = `
            UPDATE users SET 
                access_token = ?,
                refresh_token = ?,
                token_expires_at = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE refresh_token = ?
        `;
        return this.run(sql, [
            tokenData.accessToken,
            tokenData.refreshToken,
            tokenData.tokenExpiresAt,
            refreshToken
        ]);
    }

    // File operations
    async createFile(fileData) {
        const sql = `
            INSERT INTO files (figma_file_key, file_name, team_id, owner_user_id)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(figma_file_key) DO UPDATE SET
                file_name = excluded.file_name,
                team_id = excluded.team_id,
                updated_at = CURRENT_TIMESTAMP
        `;

        this.run(sql, [
            fileData.figmaFileKey,
            fileData.fileName,
            fileData.teamId,
            fileData.ownerUserId || null
        ]);

        return this.getFileByKey(fileData.figmaFileKey);
    }

    async getFileByKey(figmaFileKey) {
        return this.get('SELECT * FROM files WHERE figma_file_key = ?', [figmaFileKey]);
    }

    async updateFileLastSynced(figmaFileKey) {
        const sql = 'UPDATE files SET last_synced_at = CURRENT_TIMESTAMP WHERE figma_file_key = ?';
        return this.run(sql, [figmaFileKey]);
    }

    async deleteFile(figmaFileKey) {
        const sql = 'DELETE FROM files WHERE figma_file_key = ?';
        return this.run(sql, [figmaFileKey]);
    }

    // Comment operations
    async upsertComment(commentData) {
        const sql = `
            INSERT INTO comments (
                figma_comment_id, figma_file_key, node_id, node_name, message,
                author_name, author_handle, parent_comment_id, resolved_at, resolved_by_id,
                position_x, position_y, figma_created_at, figma_updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(figma_comment_id) DO UPDATE SET
                node_name = excluded.node_name,
                message = excluded.message,
                resolved_at = excluded.resolved_at,
                resolved_by_id = excluded.resolved_by_id,
                figma_updated_at = excluded.figma_updated_at,
                updated_at = CURRENT_TIMESTAMP
        `;

        return this.run(sql, [
            commentData.figmaCommentId,
            commentData.figmaFileKey,
            commentData.nodeId,
            commentData.nodeName,
            commentData.message,
            commentData.authorName,
            commentData.authorHandle,
            commentData.parentCommentId,
            commentData.resolvedAt,
            commentData.resolvedById || null,
            commentData.positionX || 0,
            commentData.positionY || 0,
            commentData.figmaCreatedAt,
            commentData.figmaUpdatedAt
        ]);
    }

    async getCommentsByFileKey(figmaFileKey) {
        const sql = `
            SELECT * FROM comments 
            WHERE figma_file_key = ? 
            ORDER BY figma_created_at DESC
        `;
        return this.all(sql, [figmaFileKey]);
    }

    async getCommentsByNodeId(figmaFileKey, nodeId) {
        const sql = `
            SELECT * FROM comments 
            WHERE figma_file_key = ? AND node_id = ?
            ORDER BY figma_created_at DESC
        `;
        return this.all(sql, [figmaFileKey, nodeId]);
    }

    async getCanvasComments(figmaFileKey) {
        const sql = `
            SELECT * FROM comments 
            WHERE figma_file_key = ? AND (node_id IS NULL OR node_id = '')
            ORDER BY figma_created_at DESC
        `;
        return this.all(sql, [figmaFileKey]);
    }

    async deleteComment(figmaCommentId) {
        const sql = 'DELETE FROM comments WHERE figma_comment_id = ?';
        return this.run(sql, [figmaCommentId]);
    }

    async resolveComment(figmaCommentId, resolvedByUserId) {
        const sql = `
            UPDATE comments SET 
                resolved_at = CURRENT_TIMESTAMP,
                resolved_by_id = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE figma_comment_id = ?
        `;
        return this.run(sql, [resolvedByUserId, figmaCommentId]);
    }

    async unresolveComment(figmaCommentId) {
        const sql = `
            UPDATE comments SET 
                resolved_at = NULL,
                resolved_by_id = NULL,
                updated_at = CURRENT_TIMESTAMP
            WHERE figma_comment_id = ?
        `;
        return this.run(sql, [figmaCommentId]);
    }

    // Plugin session operations
    async createPluginSession(sessionData) {
        const sql = `
            INSERT INTO plugin_sessions (user_id, figma_file_key, session_token, node_id)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(session_token) DO UPDATE SET
                user_id = excluded.user_id,
                figma_file_key = excluded.figma_file_key,
                node_id = excluded.node_id,
                last_activity_at = CURRENT_TIMESTAMP
        `;

        return this.run(sql, [
            sessionData.userId,
            sessionData.figmaFileKey,
            sessionData.sessionToken,
            sessionData.nodeId || null
        ]);
    }

    async getPluginSessionByToken(sessionToken) {
        const sql = `
            SELECT ps.*, u.name as user_name, u.handle as user_handle, u.email as user_email
            FROM plugin_sessions ps
            LEFT JOIN users u ON ps.user_id = u.id
            WHERE ps.session_token = ?
        `;
        return this.get(sql, [sessionToken]);
    }

    async updateSessionActivity(sessionToken) {
        const sql = `
            UPDATE plugin_sessions SET 
                last_activity_at = CURRENT_TIMESTAMP
            WHERE session_token = ?
        `;
        return this.run(sql, [sessionToken]);
    }

    async updateSessionNodeId(sessionToken, nodeId) {
        const sql = `
            UPDATE plugin_sessions SET 
                node_id = ?,
                last_activity_at = CURRENT_TIMESTAMP
            WHERE session_token = ?
        `;
        return this.run(sql, [nodeId, sessionToken]);
    }

    // Webhook operations
    async createWebhookEvent(eventData) {
        const sql = `
            INSERT INTO webhook_events (event_type, figma_file_key, event_data)
            VALUES (?, ?, ?)
        `;

        return this.run(sql, [
            eventData.eventType,
            eventData.figmaFileKey,
            JSON.stringify(eventData.eventData)
        ]);
    }

    async markWebhookEventProcessed(figmaFileKey, eventType, timestamp) {
        const sql = `
            UPDATE webhook_events SET 
                processed_at = CURRENT_TIMESTAMP
            WHERE figma_file_key = ? AND event_type = ? AND created_at = ?
        `;
        return this.run(sql, [figmaFileKey, eventType, timestamp]);
    }

    async getUnprocessedWebhookEvents(limit = 100) {
        const sql = `
            SELECT * FROM webhook_events 
            WHERE processed_at IS NULL 
            ORDER BY created_at ASC 
            LIMIT ?
        `;
        return this.all(sql, [limit]);
    }

    // File permission operations
    async grantFilePermission(userId, figmaFileKey, permissionLevel = 'read', grantedByUserId = null) {
        const sql = `
            INSERT INTO file_permissions (user_id, figma_file_key, permission_level, granted_by_id)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(user_id, figma_file_key) DO UPDATE SET
                permission_level = excluded.permission_level,
                granted_by_id = excluded.granted_by_id,
                granted_at = CURRENT_TIMESTAMP
        `;
        return this.run(sql, [userId, figmaFileKey, permissionLevel, grantedByUserId]);
    }

    async checkFilePermission(userId, figmaFileKey) {
        const sql = 'SELECT * FROM file_permissions WHERE user_id = ? AND figma_file_key = ?';
        return this.get(sql, [userId, figmaFileKey]);
    }

    async ensureFilePermission(userId, figmaFileKey) {
        // Check if permission exists
        const existing = await this.checkFilePermission(userId, figmaFileKey);
        
        if (!existing) {
            // Grant default read permission
            await this.grantFilePermission(userId, figmaFileKey, 'read');
            
            // Check if this is the first user for this file, if so make them admin
            const allPermissions = this.all('SELECT * FROM file_permissions WHERE figma_file_key = ?', [figmaFileKey]);
            
            if (allPermissions.length === 1) {
                // This is the first user, make them admin
                await this.grantFilePermission(userId, figmaFileKey, 'admin');
            }
            
            return this.checkFilePermission(userId, figmaFileKey);
        }
        
        return existing;
    }

    async getUserFilePermissions(userId) {
        const sql = `
            SELECT fp.*, f.file_name
            FROM file_permissions fp
            LEFT JOIN files f ON fp.figma_file_key = f.figma_file_key
            WHERE fp.user_id = ?
            ORDER BY fp.granted_at DESC
        `;
        return this.all(sql, [userId]);
    }

    // Webhook registration (for future use)
    async createWebhookRegistration(webhookData) {
        const sql = `
            INSERT INTO webhook_registrations (webhook_id, figma_file_key, endpoint_url, secret)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(figma_file_key) DO UPDATE SET
                webhook_id = excluded.webhook_id,
                endpoint_url = excluded.endpoint_url,
                secret = excluded.secret,
                updated_at = CURRENT_TIMESTAMP
        `;
        return this.run(sql, [
            webhookData.webhookId,
            webhookData.figmaFileKey,
            webhookData.endpointUrl,
            webhookData.secret
        ]);
    }

    // Analytics and stats
    async getCommentStats(figmaFileKey = null) {
        let sql, params;
        
        if (figmaFileKey) {
            sql = `
                SELECT 
                    COUNT(*) as total_comments,
                    COUNT(CASE WHEN resolved_at IS NOT NULL THEN 1 END) as resolved_comments,
                    COUNT(CASE WHEN resolved_at IS NULL THEN 1 END) as active_comments
                FROM comments 
                WHERE figma_file_key = ?
            `;
            params = [figmaFileKey];
        } else {
            sql = `
                SELECT 
                    COUNT(*) as total_comments,
                    COUNT(CASE WHEN resolved_at IS NOT NULL THEN 1 END) as resolved_comments,
                    COUNT(CASE WHEN resolved_at IS NULL THEN 1 END) as active_comments
                FROM comments
            `;
            params = [];
        }
        
        return this.get(sql, params);
    }

    async getActiveUserCount(days = 7) {
        const sql = `
            SELECT COUNT(DISTINCT user_id) as active_users
            FROM plugin_sessions 
            WHERE last_activity_at > datetime('now', '-${days} days')
        `;
        const result = this.get(sql);
        return result?.active_users || 0;
    }

    close() {
        if (this.db) {
            this.db.close();
        }
    }
}

module.exports = DatabaseWrapper; 