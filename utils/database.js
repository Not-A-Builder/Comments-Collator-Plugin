const sqlite3 = require('sqlite3').verbose();
const path = require('path');
require('dotenv').config();

class Database {
    constructor() {
        const dbPath = process.env.DATABASE_URL || './database/comments.db';
        this.db = new sqlite3.Database(dbPath, (err) => {
            if (err) {
                console.error('Error opening database:', err.message);
                throw err;
            }
            console.log('Connected to SQLite database');
        });

        // Enable foreign keys
        this.db.run('PRAGMA foreign_keys = ON');
    }

    // Helper to run queries with promises
    run(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.db.run(sql, params, function(err) {
                if (err) {
                    reject(err);
                } else {
                    resolve({ id: this.lastID, changes: this.changes });
                }
            });
        });
    }

    get(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.db.get(sql, params, (err, row) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(row);
                }
            });
        });
    }

    all(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.db.all(sql, params, (err, rows) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(rows);
                }
            });
        });
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

        const result = await this.run(sql, [
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
        const user = await this.get('SELECT * FROM users WHERE figma_user_id = ?', [userData.figmaUserId]);
        return user;
    }

    async getUserById(userId) {
        return await this.get('SELECT * FROM users WHERE id = ?', [userId]);
    }

    async getUserByFigmaId(figmaUserId) {
        return await this.get('SELECT * FROM users WHERE figma_user_id = ?', [figmaUserId]);
    }

    async getUserByHandle(handle) {
        return await this.get('SELECT * FROM users WHERE handle = ?', [handle]);
    }

    async getAnyValidUser() {
        const sql = `
            SELECT * FROM users 
            WHERE access_token IS NOT NULL 
            AND (token_expires_at IS NULL OR token_expires_at > datetime('now'))
            ORDER BY updated_at DESC 
            LIMIT 1
        `;
        return await this.get(sql);
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
        return await this.run(sql, [
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

        await this.run(sql, [
            fileData.figmaFileKey,
            fileData.fileName,
            fileData.teamId,
            fileData.ownerUserId || null
        ]);

        return await this.getFileByKey(fileData.figmaFileKey);
    }

    async getFileByKey(figmaFileKey) {
        return await this.get('SELECT * FROM files WHERE figma_file_key = ?', [figmaFileKey]);
    }

    async updateFileLastSynced(figmaFileKey) {
        const sql = 'UPDATE files SET last_synced_at = CURRENT_TIMESTAMP WHERE figma_file_key = ?';
        return await this.run(sql, [figmaFileKey]);
    }

    async deleteFile(figmaFileKey) {
        const sql = 'DELETE FROM files WHERE figma_file_key = ?';
        return await this.run(sql, [figmaFileKey]);
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

        return await this.run(sql, [
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
            ORDER BY figma_created_at ASC
        `;
        return await this.all(sql, [figmaFileKey]);
    }

    async getCommentsByNodeId(figmaFileKey, nodeId) {
        const sql = `
            SELECT * FROM comments 
            WHERE figma_file_key = ? AND node_id = ? 
            ORDER BY figma_created_at ASC
        `;
        return await this.all(sql, [figmaFileKey, nodeId]);
    }

    async deleteComment(figmaCommentId) {
        const sql = 'DELETE FROM comments WHERE figma_comment_id = ?';
        return await this.run(sql, [figmaCommentId]);
    }

    async resolveComment(figmaCommentId, resolvedByUserId) {
        const sql = `
            UPDATE comments SET 
                resolved_at = CURRENT_TIMESTAMP,
                resolved_by_id = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE figma_comment_id = ?
        `;
        return await this.run(sql, [resolvedByUserId, figmaCommentId]);
    }

    async unresolveComment(figmaCommentId) {
        const sql = `
            UPDATE comments SET 
                resolved_at = NULL,
                resolved_by_id = NULL,
                updated_at = CURRENT_TIMESTAMP
            WHERE figma_comment_id = ?
        `;
        return await this.run(sql, [figmaCommentId]);
    }

    // Plugin session operations
    async createPluginSession(sessionData) {
        const sql = `
            INSERT INTO plugin_sessions (user_id, figma_file_key, session_token, node_id)
            VALUES (?, ?, ?, ?)
        `;

        return await this.run(sql, [
            sessionData.userId,
            sessionData.figmaFileKey,
            sessionData.sessionToken,
            sessionData.nodeId || null
        ]);
    }

    async getPluginSessionByToken(sessionToken) {
        const sql = `
            SELECT ps.*, u.figma_user_id, u.name, u.handle, u.email
            FROM plugin_sessions ps
            JOIN users u ON ps.user_id = u.id
            WHERE ps.session_token = ?
            AND ps.created_at > datetime('now', '-24 hours')
        `;
        return await this.get(sql, [sessionToken]);
    }

    async updateSessionActivity(sessionToken) {
        const sql = `
            UPDATE plugin_sessions 
            SET last_activity_at = CURRENT_TIMESTAMP 
            WHERE session_token = ?
        `;
        return await this.run(sql, [sessionToken]);
    }

    async updateSessionNodeId(sessionToken, nodeId) {
        const sql = `
            UPDATE plugin_sessions 
            SET node_id = ?, last_activity_at = CURRENT_TIMESTAMP 
            WHERE session_token = ?
        `;
        return await this.run(sql, [nodeId, sessionToken]);
    }

    // Webhook event operations
    async createWebhookEvent(eventData) {
        const sql = `
            INSERT INTO webhook_events (event_type, figma_file_key, event_data)
            VALUES (?, ?, ?)
        `;

        return await this.run(sql, [
            eventData.eventType,
            eventData.figmaFileKey,
            eventData.eventData
        ]);
    }

    async markWebhookEventProcessed(figmaFileKey, eventType, timestamp) {
        const sql = `
            UPDATE webhook_events 
            SET processed_at = CURRENT_TIMESTAMP 
            WHERE figma_file_key = ? AND event_type = ? AND created_at >= ?
        `;
        return await this.run(sql, [figmaFileKey, eventType, timestamp]);
    }

    async getUnprocessedWebhookEvents(limit = 100) {
        const sql = `
            SELECT * FROM webhook_events 
            WHERE processed_at IS NULL 
            ORDER BY created_at ASC 
            LIMIT ?
        `;
        return await this.all(sql, [limit]);
    }

    // File permissions operations
    async grantFilePermission(userId, figmaFileKey, permissionLevel = 'read', grantedByUserId = null) {
        const sql = `
            INSERT INTO file_permissions (user_id, figma_file_key, permission_level, granted_by_id)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(user_id, figma_file_key) DO UPDATE SET
                permission_level = excluded.permission_level,
                granted_by_id = excluded.granted_by_id,
                granted_at = CURRENT_TIMESTAMP
        `;

        return await this.run(sql, [userId, figmaFileKey, permissionLevel, grantedByUserId]);
    }

    async checkFilePermission(userId, figmaFileKey) {
        const sql = `
            SELECT permission_level FROM file_permissions 
            WHERE user_id = ? AND figma_file_key = ?
        `;
        const result = await this.get(sql, [userId, figmaFileKey]);
        return result ? result.permission_level : null;
    }

    async ensureFilePermission(userId, figmaFileKey) {
        // Check existing permission
        let permission = await this.checkFilePermission(userId, figmaFileKey);
        
        if (!permission) {
            // Ensure the file exists in the files table first
            let file = await this.getFileByKey(figmaFileKey);
            if (!file) {
                console.log(`Creating file record for ${figmaFileKey}`);
                // Create a basic file record - we'll update it later when we have more info
                file = await this.createFile({
                    figmaFileKey: figmaFileKey,
                    fileName: 'Unknown File', // Placeholder name
                    teamId: null,
                    ownerUserId: userId
                });
            }
            
            // No permission exists, grant default read permission
            console.log(`Granting default read permission to user ${userId} for file ${figmaFileKey}`);
            await this.grantFilePermission(userId, figmaFileKey, 'read', null);
            permission = 'read';
        }
        
        return permission;
    }

    async getUserFilePermissions(userId) {
        const sql = `
            SELECT fp.*, f.file_name 
            FROM file_permissions fp
            JOIN files f ON fp.figma_file_key = f.figma_file_key
            WHERE fp.user_id = ?
            ORDER BY fp.granted_at DESC
        `;
        return await this.all(sql, [userId]);
    }

    // Webhook registration operations (for tracking webhook setup)
    async createWebhookRegistration(webhookData) {
        const sql = `
            INSERT INTO webhook_registrations (figma_file_key, event_type, endpoint, status)
            VALUES (?, ?, ?, ?)
        `;

        return await this.run(sql, [
            webhookData.figmaFileKey,
            webhookData.eventType,
            webhookData.endpoint,
            webhookData.status
        ]);
    }

    // Analytics and monitoring
    async getCommentStats(figmaFileKey = null) {
        let sql = `
            SELECT 
                COUNT(*) as total_comments,
                COUNT(DISTINCT author_handle) as unique_authors,
                COUNT(CASE WHEN resolved_at IS NOT NULL THEN 1 END) as resolved_comments,
                COUNT(CASE WHEN resolved_at IS NULL THEN 1 END) as active_comments
            FROM comments
        `;

        const params = [];
        if (figmaFileKey) {
            sql += ' WHERE figma_file_key = ?';
            params.push(figmaFileKey);
        }

        return await this.get(sql, params);
    }

    async getActiveUserCount(days = 7) {
        const sql = `
            SELECT COUNT(DISTINCT user_id) as active_users
            FROM plugin_sessions 
            WHERE last_activity_at > datetime('now', '-${days} days')
        `;
        return await this.get(sql);
    }

    // Close database connection
    close() {
        return new Promise((resolve, reject) => {
            this.db.close((err) => {
                if (err) {
                    reject(err);
                } else {
                    resolve();
                }
            });
        });
    }
}

module.exports = new Database(); 