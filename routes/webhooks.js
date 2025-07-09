const express = require('express');
const crypto = require('crypto');
const { body, validationResult } = require('express-validator');
const Database = require('../utils/database');
const db = new Database();
const figmaApi = require('../utils/figma-api');

const router = express.Router();

// Middleware to verify Figma webhook signature
function verifyFigmaSignature(req, res, next) {
    const signature = req.get('X-Figma-Webhook-Signature');
    const webhookSecret = process.env.WEBHOOK_SECRET;
    
    if (!signature || !webhookSecret) {
        return res.status(401).json({
            error: 'Missing webhook signature or secret'
        });
    }
    
    // Figma sends signature as hex-encoded HMAC-SHA256
    const expectedSignature = crypto
        .createHmac('sha256', webhookSecret)
        .update(req.body, 'utf8')
        .digest('hex');
    
    if (!crypto.timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expectedSignature, 'hex'))) {
        return res.status(401).json({
            error: 'Invalid webhook signature'
        });
    }
    
    next();
}

// Parse raw body for signature verification
router.use('/figma', express.raw({ type: 'application/json' }));

// Main Figma webhook endpoint
router.post('/figma', verifyFigmaSignature, async (req, res) => {
    try {
        // Parse JSON after signature verification
        const event = JSON.parse(req.body.toString());
        
        console.log('Received Figma webhook:', {
            type: event.event_type,
            fileKey: event.file_key,
            timestamp: event.timestamp
        });
        
        // Store webhook event for debugging/audit
        db.createWebhookEvent({
            eventType: event.event_type,
            figmaFileKey: event.file_key,
            eventData: JSON.stringify(event)
        });
        
        // Process different event types
        switch (event.event_type) {
            case 'FILE_COMMENT':
                await handleFileCommentEvent(event);
                break;
            case 'FILE_UPDATE':
                await handleFileUpdateEvent(event);
                break;
            case 'FILE_DELETE':
                await handleFileDeleteEvent(event);
                break;
            case 'LIBRARY_PUBLISH':
                // Handle library publish events if needed
                console.log('Library publish event received, skipping');
                break;
            default:
                console.log(`Unknown event type: ${event.event_type}`);
        }
        
        // Mark event as processed
        db.markWebhookEventProcessed(event.file_key, event.event_type, event.timestamp);
        
        // Respond with 200 to acknowledge receipt
        res.status(200).json({ 
            success: true, 
            message: 'Webhook processed successfully' 
        });
        
    } catch (error) {
        console.error('Webhook processing error:', error);
        res.status(500).json({
            error: 'Failed to process webhook',
            message: error.message
        });
    }
});

// Handle comment-related events
async function handleFileCommentEvent(event) {
    const { file_key, triggered_by, comment } = event;
    
    try {
        // Ensure we have file information
        let file = db.getFileByKey(file_key);
        if (!file) {
            // Fetch file info from Figma API and store it
            const fileInfo = await figmaApi.getFileInfo(file_key);
            file = db.createFile({
                figmaFileKey: file_key,
                fileName: fileInfo.name,
                teamId: fileInfo.team_id
            });
        }
        
        // Process the comment
        if (comment) {
            await processComment(file_key, comment, triggered_by);
        }
        
        // If this is a comment deletion or resolution, handle accordingly
        if (event.action === 'DELETE') {
            db.deleteComment(comment.id);
        } else if (event.action === 'RESOLVE') {
            db.resolveComment(comment.id, triggered_by.id);
        }
        
        console.log(`Processed comment event for file ${file_key}`);
        
    } catch (error) {
        console.error('Error handling file comment event:', error);
        throw error;
    }
}

// Process individual comment data
async function processComment(fileKey, comment, triggeredBy) {
    try {
        // Get node information if available
        let nodeName = comment.client_meta?.node_id ? await getNodeName(fileKey, comment.client_meta.node_id) : null;
        
        // Store or update comment in database
        db.upsertComment({
            figmaCommentId: comment.id,
            figmaFileKey: fileKey,
            nodeId: comment.client_meta?.node_id || null,
            nodeName: nodeName,
            message: comment.message,
            authorName: comment.user?.name || triggeredBy?.name,
            authorHandle: comment.user?.handle || triggeredBy?.handle,
            parentCommentId: comment.parent_id || null,
            positionX: comment.client_meta?.node_offset?.x || 0,
            positionY: comment.client_meta?.node_offset?.y || 0,
            figmaCreatedAt: new Date(comment.created_at),
            figmaUpdatedAt: comment.updated_at ? new Date(comment.updated_at) : null
        });
        
        console.log(`Stored comment ${comment.id} for file ${fileKey}`);
        
    } catch (error) {
        console.error('Error processing comment:', error);
        throw error;
    }
}

// Get node name from Figma API
async function getNodeName(fileKey, nodeId) {
    try {
        const nodeInfo = await figmaApi.getNodeInfo(fileKey, nodeId);
        return nodeInfo?.name || null;
    } catch (error) {
        console.error(`Error fetching node name for ${nodeId}:`, error);
        return null;
    }
}

// Handle file update events
async function handleFileUpdateEvent(event) {
    const { file_key, triggered_by } = event;
    
    try {
        // Update file last_synced_at timestamp
        db.updateFileLastSynced(file_key);
        
        // Optionally re-sync comments if needed
        console.log(`File ${file_key} updated by ${triggered_by?.handle || 'unknown'}`);
        
    } catch (error) {
        console.error('Error handling file update event:', error);
        throw error;
    }
}

// Handle file deletion events
async function handleFileDeleteEvent(event) {
    const { file_key } = event;
    
    try {
        // Clean up file and associated data
        db.deleteFile(file_key);
        console.log(`File ${file_key} deleted, cleaned up associated data`);
        
    } catch (error) {
        console.error('Error handling file delete event:', error);
        throw error;
    }
}

// Webhook registration endpoint (for setting up webhooks via API)
router.post('/register', [
    body('file_key').notEmpty().withMessage('File key is required'),
    body('event_type').isIn(['FILE_COMMENT', 'FILE_UPDATE', 'FILE_DELETE']).withMessage('Invalid event type'),
    body('endpoint').isURL().withMessage('Valid endpoint URL is required')
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ 
            error: 'Validation Error',
            details: errors.array() 
        });
    }
    
    try {
        const { file_key, event_type, endpoint } = req.body;
        
        // Register webhook with Figma (this would be implemented based on Figma's webhook API)
        // For now, we'll just store the registration intent
        
        db.createWebhookRegistration({
            figmaFileKey: file_key,
            eventType: event_type,
            endpoint: endpoint,
            status: 'registered'
        });
        
        res.json({
            success: true,
            message: 'Webhook registration recorded',
            file_key,
            event_type,
            endpoint
        });
        
    } catch (error) {
        console.error('Webhook registration error:', error);
        res.status(500).json({
            error: 'Failed to register webhook'
        });
    }
});

// Health check for webhook endpoint
router.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        endpoint: '/webhooks/figma',
        timestamp: new Date().toISOString()
    });
});

// Test endpoint for webhook development
if (process.env.NODE_ENV === 'development') {
    router.post('/test', express.json(), async (req, res) => {
        try {
            console.log('Test webhook received:', req.body);
            
            // Simulate webhook processing
            const event = req.body;
            if (event.event_type === 'FILE_COMMENT') {
                await handleFileCommentEvent(event);
            }
            
            res.json({
                success: true,
                message: 'Test webhook processed',
                received: event
            });
            
        } catch (error) {
            console.error('Test webhook error:', error);
            res.status(500).json({
                error: 'Test webhook failed',
                message: error.message
            });
        }
    });
}

module.exports = router; 