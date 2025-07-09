const express = require('express');
const { body, validationResult } = require('express-validator');
const Database = require('../utils/database');
const db = new Database();
const figmaApi = require('../utils/figma-api');

const router = express.Router();

// Middleware to authenticate session token
async function authenticateSession(req, res, next) {
    const sessionToken = req.headers.authorization?.replace('Bearer ', '');
    
    if (!sessionToken) {
        return res.status(401).json({
            error: 'Missing session token'
        });
    }
    
    try {
        const session = await db.getPluginSessionByToken(sessionToken);
        if (!session) {
            return res.status(401).json({
                error: 'Invalid or expired session token'
            });
        }
        
        // Update session activity
        await db.updateSessionActivity(sessionToken);
        
        req.session = session;
        req.userId = session.user_id;
        next();
        
    } catch (error) {
        console.error('Session authentication error:', error);
        res.status(500).json({
            error: 'Authentication failed'
        });
    }
}

// Get user profile
router.get('/user/profile', authenticateSession, (req, res) => {
    res.json({
        success: true,
        user: {
            id: req.session.user_id,
            figmaUserId: req.session.figma_user_id,
            name: req.session.name,
            handle: req.session.handle,
            email: req.session.email
        }
    });
});

// Get user's accessible files
router.get('/user/files', authenticateSession, async (req, res) => {
    try {
        const permissions = await db.getUserFilePermissions(req.userId);
        
        res.json({
            success: true,
            files: permissions.map(perm => ({
                figmaFileKey: perm.figma_file_key,
                fileName: perm.file_name,
                permissionLevel: perm.permission_level,
                grantedAt: perm.granted_at
            }))
        });
        
    } catch (error) {
        console.error('Error fetching user files:', error);
        res.status(500).json({
            error: 'Failed to fetch files'
        });
    }
});

// Get file information
router.get('/files/:fileKey', authenticateSession, async (req, res) => {
    try {
        const { fileKey } = req.params;
        
        // Check user permissions (auto-grant read if none exist)
        const permission = await db.ensureFilePermission(req.userId, fileKey);
        if (!permission) {
            return res.status(403).json({
                error: 'Access denied to this file'
            });
        }
        
        // Get file info from database
        let file = await db.getFileByKey(fileKey);
        
        // If not in database, fetch from Figma API
        if (!file) {
            const fileInfo = await figmaApi.getFileInfo(fileKey, req.userId);
            file = await db.createFile({
                figmaFileKey: fileKey,
                fileName: fileInfo.name,
                teamId: fileInfo.team_id,
                ownerUserId: req.userId
            });
        } else if (file.file_name === 'Unknown File') {
            // Try to update placeholder file with real info from Figma API
            try {
                const fileInfo = await figmaApi.getFileInfo(fileKey, req.userId);
                file = await db.createFile({
                    figmaFileKey: fileKey,
                    fileName: fileInfo.name,
                    teamId: fileInfo.team_id,
                    ownerUserId: req.userId
                });
            } catch (error) {
                console.log(`Could not fetch file info from Figma API: ${error.message}`);
                // Continue with placeholder file info
            }
        }
        
        res.json({
            success: true,
            file: {
                key: file.figma_file_key,
                name: file.file_name,
                teamId: file.team_id,
                lastSynced: file.last_synced_at,
                createdAt: file.created_at
            }
        });
        
    } catch (error) {
        console.error('Error fetching file info:', error);
        res.status(500).json({
            error: 'Failed to fetch file information'
        });
    }
});

// Sync file comments
router.post('/files/:fileKey/sync', authenticateSession, async (req, res) => {
    try {
        const { fileKey } = req.params;
        
        // Check user permissions (auto-grant read if none exist)
        const permission = await db.ensureFilePermission(req.userId, fileKey);
        if (!permission) {
            return res.status(403).json({
                error: 'Access denied to this file'
            });
        }
        
        // Sync comments from Figma API
        const syncResult = await figmaApi.syncFileComments(fileKey, req.userId);
        
        res.json({
            success: true,
            message: 'Comments synced successfully',
            ...syncResult
        });
        
    } catch (error) {
        console.error('Error syncing comments:', error);
        res.status(500).json({
            error: 'Failed to sync comments',
            message: error.message
        });
    }
});

// Update session node ID (for tracking current selection)
router.put('/session/node', [
    authenticateSession,
    body('nodeId').optional().isString(),
    body('fileKey').notEmpty().withMessage('File key is required')
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ 
            error: 'Validation Error',
            details: errors.array() 
        });
    }
    
    try {
        const { nodeId, fileKey } = req.body;
        
        // Update session with current node
        await db.updateSessionNodeId(req.session.session_token, nodeId);
        
        res.json({
            success: true,
            message: 'Session updated',
            nodeId: nodeId,
            fileKey: fileKey
        });
        
    } catch (error) {
        console.error('Error updating session:', error);
        res.status(500).json({
            error: 'Failed to update session'
        });
    }
});

// Get comment statistics
router.get('/files/:fileKey/stats', authenticateSession, async (req, res) => {
    try {
        const { fileKey } = req.params;
        
        // Check user permissions (auto-grant read if none exist)
        const permission = await db.ensureFilePermission(req.userId, fileKey);
        if (!permission) {
            return res.status(403).json({
                error: 'Access denied to this file'
            });
        }
        
        const stats = await db.getCommentStats(fileKey);
        
        res.json({
            success: true,
            stats: {
                totalComments: stats.total_comments,
                uniqueAuthors: stats.unique_authors,
                resolvedComments: stats.resolved_comments,
                activeComments: stats.active_comments
            }
        });
        
    } catch (error) {
        console.error('Error fetching comment stats:', error);
        res.status(500).json({
            error: 'Failed to fetch statistics'
        });
    }
});

// Grant file permission (admin only)
router.post('/files/:fileKey/permissions', [
    authenticateSession,
    body('userHandle').notEmpty().withMessage('User handle is required'),
    body('permissionLevel').isIn(['read', 'write', 'admin']).withMessage('Invalid permission level')
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ 
            error: 'Validation Error',
            details: errors.array() 
        });
    }
    
    try {
        const { fileKey } = req.params;
        const { userHandle, permissionLevel } = req.body;
        
        // Check if current user has admin permission
        const currentPermission = await db.checkFilePermission(req.userId, fileKey);
        if (currentPermission !== 'admin') {
            return res.status(403).json({
                error: 'Admin permission required'
            });
        }
        
        // Find target user by handle
        const targetUser = await db.getUserByHandle(userHandle);
        if (!targetUser) {
            return res.status(404).json({
                error: 'User not found'
            });
        }
        
        // Grant permission
        await db.grantFilePermission(targetUser.id, fileKey, permissionLevel, req.userId);
        
        res.json({
            success: true,
            message: `Granted ${permissionLevel} permission to ${userHandle}`,
            userHandle,
            permissionLevel
        });
        
    } catch (error) {
        console.error('Error granting permission:', error);
        res.status(500).json({
            error: 'Failed to grant permission'
        });
    }
});

// Health check
router.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        service: 'Comments Collator API'
    });
});

module.exports = router; 