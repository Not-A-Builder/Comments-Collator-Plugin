const express = require('express');
const { body, validationResult, query } = require('express-validator');
const db = require('../utils/database');
const figmaApi = require('../utils/figma-api');

const router = express.Router();

// Middleware to authenticate session token (copied from api.js for consistency)
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

// Get comments for a file
router.get('/:fileKey', [
    authenticateSession,
    query('nodeId').optional().isString()
], async (req, res) => {
    try {
        const { fileKey } = req.params;
        const { nodeId } = req.query;
        
        // Check user permissions (auto-grant read if none exist)
        const permission = await db.ensureFilePermission(req.userId, fileKey);
        if (!permission) {
            return res.status(403).json({
                error: 'Access denied to this file'
            });
        }
        
        let comments;
        if (nodeId) {
            // Get comments for specific node
            comments = await db.getCommentsByNodeId(fileKey, nodeId);
        } else {
            // Get all comments for file
            comments = await db.getCommentsByFileKey(fileKey);
        }
        
        // Format comments for response
        const formattedComments = comments.map(comment => ({
            id: comment.figma_comment_id,
            message: comment.message,
            author: {
                name: comment.author_name,
                handle: comment.author_handle
            },
            nodeId: comment.node_id,
            nodeName: comment.node_name,
            parentId: comment.parent_comment_id,
            position: {
                x: comment.position_x,
                y: comment.position_y
            },
            createdAt: comment.figma_created_at,
            updatedAt: comment.figma_updated_at,
            resolvedAt: comment.resolved_at,
            isResolved: !!comment.resolved_at
        }));
        
        res.json({
            success: true,
            comments: formattedComments,
            count: formattedComments.length,
            fileKey: fileKey,
            nodeId: nodeId || null
        });
        
    } catch (error) {
        console.error('Error fetching comments:', error);
        res.status(500).json({
            error: 'Failed to fetch comments',
            message: error.message
        });
    }
});

// Get canvas-level comments (comments not associated with frames)
router.get('/:fileKey/canvas', authenticateSession, async (req, res) => {
    try {
        const { fileKey } = req.params;
        
        // Check user permissions (auto-grant read if none exist)
        const permission = await db.ensureFilePermission(req.userId, fileKey);
        if (!permission) {
            return res.status(403).json({
                error: 'Access denied to this file'
            });
        }
        
        // Get canvas-level comments only
        const comments = await db.getCanvasComments(fileKey);
        
        // Format comments for response
        const formattedComments = comments.map(comment => ({
            id: comment.figma_comment_id,
            message: comment.message,
            author: {
                name: comment.author_name,
                handle: comment.author_handle
            },
            nodeId: comment.node_id,
            nodeName: comment.node_name,
            parentId: comment.parent_comment_id,
            position: {
                x: comment.position_x,
                y: comment.position_y
            },
            createdAt: comment.figma_created_at,
            updatedAt: comment.figma_updated_at,
            resolvedAt: comment.resolved_at,
            isResolved: !!comment.resolved_at
        }));
        
        res.json({
            success: true,
            comments: formattedComments,
            count: formattedComments.length,
            fileKey: fileKey,
            type: 'canvas'
        });
        
    } catch (error) {
        console.error('Error fetching canvas comments:', error);
        res.status(500).json({
            error: 'Failed to fetch canvas comments',
            message: error.message
        });
    }
});

// Post a new comment
router.post('/:fileKey', [
    authenticateSession,
    body('message').notEmpty().trim().withMessage('Comment message is required'),
    body('nodeId').optional().isString(),
    body('parentId').optional().isString(),
    body('position').optional().isObject()
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
        const { message, nodeId, parentId, position } = req.body;
        
        // Check user permissions (auto-grant read if none exist)
        const permission = await db.ensureFilePermission(req.userId, fileKey);
        if (!permission || permission === 'read') {
            return res.status(403).json({
                error: 'Write permission required to post comments'
            });
        }
        
        // Post comment via Figma API
        const commentData = {
            message: message,
            nodeId: nodeId,
            parentId: parentId,
            position: position || { x: 0, y: 0 }
        };
        
        const figmaComment = await figmaApi.postComment(fileKey, req.userId, commentData);
        
        // Store comment in database
        await db.upsertComment({
            figmaCommentId: figmaComment.id,
            figmaFileKey: fileKey,
            nodeId: nodeId,
            nodeName: nodeId ? await getNodeName(fileKey, nodeId, req.userId) : null,
            message: message,
            authorName: req.session.name,
            authorHandle: req.session.handle,
            parentCommentId: parentId,
            positionX: position?.x || 0,
            positionY: position?.y || 0,
            figmaCreatedAt: new Date(figmaComment.created_at),
            figmaUpdatedAt: figmaComment.updated_at ? new Date(figmaComment.updated_at) : null
        });
        
        res.status(201).json({
            success: true,
            message: 'Comment posted successfully',
            comment: {
                id: figmaComment.id,
                message: message,
                author: {
                    name: req.session.name,
                    handle: req.session.handle
                },
                nodeId: nodeId,
                parentId: parentId,
                position: position || { x: 0, y: 0 },
                createdAt: figmaComment.created_at
            }
        });
        
    } catch (error) {
        console.error('Error posting comment:', error);
        res.status(500).json({
            error: 'Failed to post comment',
            message: error.message
        });
    }
});

// Resolve a comment
router.put('/:fileKey/:commentId/resolve', authenticateSession, async (req, res) => {
    try {
        const { fileKey, commentId } = req.params;
        
        // Check user permissions (auto-grant read if none exist)
        const permission = await db.ensureFilePermission(req.userId, fileKey);
        if (!permission || permission === 'read') {
            return res.status(403).json({
                error: 'Write permission required to resolve comments'
            });
        }
        
        // Resolve comment via Figma API
        await figmaApi.resolveComment(fileKey, commentId, req.userId);
        
        // Update comment in database
        await db.resolveComment(commentId, req.userId);
        
        res.json({
            success: true,
            message: 'Comment resolved successfully',
            commentId: commentId,
            resolvedBy: req.session.handle,
            resolvedAt: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('Error resolving comment:', error);
        res.status(500).json({
            error: 'Failed to resolve comment',
            message: error.message
        });
    }
});

// Unresolve a comment (mark as active again)
router.put('/:fileKey/:commentId/unresolve', authenticateSession, async (req, res) => {
    try {
        const { fileKey, commentId } = req.params;
        
        // Check user permissions (auto-grant read if none exist)
        const permission = await db.ensureFilePermission(req.userId, fileKey);
        if (!permission || permission === 'read') {
            return res.status(403).json({
                error: 'Write permission required to unresolve comments'
            });
        }
        
        // Unresolve comment in database
        await db.unresolveComment(commentId);
        
        res.json({
            success: true,
            message: 'Comment marked as unresolved',
            commentId: commentId,
            unresolvedBy: req.session.handle,
            unresolvedAt: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('Error unresolving comment:', error);
        res.status(500).json({
            error: 'Failed to unresolve comment',
            message: error.message
        });
    }
});

// Get comment thread (parent + all replies)
router.get('/:fileKey/:commentId/thread', authenticateSession, async (req, res) => {
    try {
        const { fileKey, commentId } = req.params;
        
        // Check user permissions (auto-grant read if none exist)
        const permission = await db.ensureFilePermission(req.userId, fileKey);
        if (!permission) {
            return res.status(403).json({
                error: 'Access denied to this file'
            });
        }
        
        // Get parent comment
        const parentComment = await db.get(
            'SELECT * FROM comments WHERE figma_comment_id = ? AND figma_file_key = ?',
            [commentId, fileKey]
        );
        
        if (!parentComment) {
            return res.status(404).json({
                error: 'Comment not found'
            });
        }
        
        // Get all replies to this comment
        const replies = await db.all(
            'SELECT * FROM comments WHERE parent_comment_id = ? AND figma_file_key = ? ORDER BY figma_created_at ASC',
            [commentId, fileKey]
        );
        
        const formatComment = (comment) => ({
            id: comment.figma_comment_id,
            message: comment.message,
            author: {
                name: comment.author_name,
                handle: comment.author_handle
            },
            nodeId: comment.node_id,
            nodeName: comment.node_name,
            parentId: comment.parent_comment_id,
            position: {
                x: comment.position_x,
                y: comment.position_y
            },
            createdAt: comment.figma_created_at,
            updatedAt: comment.figma_updated_at,
            resolvedAt: comment.resolved_at,
            isResolved: !!comment.resolved_at
        });
        
        res.json({
            success: true,
            thread: {
                parent: formatComment(parentComment),
                replies: replies.map(formatComment)
            },
            count: 1 + replies.length
        });
        
    } catch (error) {
        console.error('Error fetching comment thread:', error);
        res.status(500).json({
            error: 'Failed to fetch comment thread',
            message: error.message
        });
    }
});

// Get comments summary for plugin UI
router.get('/:fileKey/summary', authenticateSession, async (req, res) => {
    try {
        const { fileKey } = req.params;
        const { nodeId } = req.query;
        
        // Check user permissions (auto-grant read if none exist)
        const permission = await db.ensureFilePermission(req.userId, fileKey);
        if (!permission) {
            return res.status(403).json({
                error: 'Access denied to this file'
            });
        }
        
        let comments;
        if (nodeId) {
            comments = await db.getCommentsByNodeId(fileKey, nodeId);
        } else {
            comments = await db.getCommentsByFileKey(fileKey);
        }
        
        // Group comments by status and create summary
        const summary = {
            total: comments.length,
            active: comments.filter(c => !c.resolved_at).length,
            resolved: comments.filter(c => !!c.resolved_at).length,
            byAuthor: {},
            recent: comments
                .filter(c => !c.resolved_at)
                .sort((a, b) => new Date(b.figma_created_at) - new Date(a.figma_created_at))
                .slice(0, 5)
                .map(comment => ({
                    id: comment.figma_comment_id,
                    message: comment.message.slice(0, 100) + (comment.message.length > 100 ? '...' : ''),
                    author: comment.author_handle,
                    createdAt: comment.figma_created_at,
                    nodeId: comment.node_id,
                    nodeName: comment.node_name
                }))
        };
        
        // Count comments by author
        comments.forEach(comment => {
            const author = comment.author_handle || 'Unknown';
            summary.byAuthor[author] = (summary.byAuthor[author] || 0) + 1;
        });
        
        res.json({
            success: true,
            summary: summary,
            fileKey: fileKey,
            nodeId: nodeId || null,
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('Error fetching comments summary:', error);
        res.status(500).json({
            error: 'Failed to fetch comments summary',
            message: error.message
        });
    }
});

// Helper function to get node name
async function getNodeName(fileKey, nodeId, userId) {
    try {
        const nodeInfo = await figmaApi.getNodeInfo(fileKey, nodeId, userId);
        return nodeInfo?.name || null;
    } catch (error) {
        console.error(`Error fetching node name for ${nodeId}:`, error);
        return null;
    }
}

module.exports = router; 