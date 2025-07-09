const axios = require('axios');
const Database = require('./database');
const db = new Database();

class FigmaAPI {
    constructor() {
        this.baseURL = process.env.FIGMA_API_BASE_URL || 'https://api.figma.com/v1';
        this.timeout = 30000; // 30 seconds
    }

    // Create authenticated axios instance for a user
    async createAuthenticatedClient(userId) {
        const user = db.getUserById(userId);
        if (!user) {
            throw new Error('User not found');
        }

        // Check if token is expired and refresh if needed
        if (user.token_expires_at && new Date(user.token_expires_at) <= new Date()) {
            await this.refreshUserToken(user);
            // Refetch user with updated token
            const refreshedUser = db.getUserById(userId);
            user.access_token = refreshedUser.access_token;
        }

        return axios.create({
            baseURL: this.baseURL,
            timeout: this.timeout,
            headers: {
                'Authorization': `Bearer ${user.access_token}`,
                'Content-Type': 'application/json',
                'User-Agent': 'Comments-Collator/1.0'
            }
        });
    }

    // Refresh user's access token
    async refreshUserToken(user) {
        try {
            const response = await axios.post('https://www.figma.com/api/oauth/token', {
                client_id: process.env.FIGMA_CLIENT_ID,
                client_secret: process.env.FIGMA_CLIENT_SECRET,
                refresh_token: user.refresh_token,
                grant_type: 'refresh_token'
            });

            const { access_token, refresh_token: new_refresh_token, expires_in } = response.data;
            const expiresAt = new Date(Date.now() + (expires_in * 1000));

            db.updateUserTokens(user.refresh_token, {
                accessToken: access_token,
                refreshToken: new_refresh_token || user.refresh_token,
                tokenExpiresAt: expiresAt
            });

            console.log(`Refreshed token for user ${user.figma_user_id}`);
            
        } catch (error) {
            console.error('Token refresh failed:', error);
            throw new Error('Failed to refresh access token');
        }
    }

    // Get file information
    async getFileInfo(fileKey, userId = null) {
        try {
            let client;
            
            if (userId) {
                client = await this.createAuthenticatedClient(userId);
            } else {
                // Use any available user token for file info
                const user = db.getAnyValidUser();
                if (!user) {
                    throw new Error('No authenticated users available');
                }
                client = await this.createAuthenticatedClient(user.id);
            }

            const response = await client.get(`/files/${fileKey}`);
            
            return {
                key: fileKey,
                name: response.data.name,
                lastModified: response.data.lastModified,
                thumbnailUrl: response.data.thumbnailUrl,
                version: response.data.version,
                team_id: response.data.team_id,
                nodes: response.data.document
            };
            
        } catch (error) {
            console.error(`Error fetching file info for ${fileKey}:`, error);
            throw new Error(`Failed to fetch file information: ${error.message}`);
        }
    }

    // Get specific node information
    async getNodeInfo(fileKey, nodeId, userId = null) {
        try {
            let client;
            
            if (userId) {
                client = await this.createAuthenticatedClient(userId);
            } else {
                const user = db.getAnyValidUser();
                if (!user) {
                    throw new Error('No authenticated users available');
                }
                client = await this.createAuthenticatedClient(user.id);
            }

            const response = await client.get(`/files/${fileKey}/nodes`, {
                params: { ids: nodeId }
            });
            
            const nodeData = response.data.nodes[nodeId];
            return {
                id: nodeId,
                name: nodeData?.document?.name || 'Unknown Node',
                type: nodeData?.document?.type,
                visible: nodeData?.document?.visible,
                bounds: nodeData?.document?.absoluteBoundingBox
            };
            
        } catch (error) {
            console.error(`Error fetching node info for ${nodeId}:`, error);
            return null;
        }
    }

    // Get comments for a file
    async getFileComments(fileKey, userId) {
        try {
            const client = await this.createAuthenticatedClient(userId);
            
            const response = await client.get(`/files/${fileKey}/comments`);
            
            const comments = response.data.comments || [];
            
            // Process and enhance comments
            const processedComments = await Promise.all(comments.map(async (comment) => {
                // Get node name if node_id is available
                let nodeName = null;
                if (comment.client_meta?.node_id) {
                    const nodeInfo = await this.getNodeInfo(fileKey, comment.client_meta.node_id, userId);
                    nodeName = nodeInfo?.name;
                }

                return {
                    id: comment.id,
                    message: comment.message,
                    user: comment.user,
                    created_at: comment.created_at,
                    updated_at: comment.updated_at,
                    resolved_at: comment.resolved_at,
                    parent_id: comment.parent_id,
                    node_id: comment.client_meta?.node_id,
                    node_name: nodeName,
                    position: {
                        x: comment.client_meta?.node_offset?.x || 0,
                        y: comment.client_meta?.node_offset?.y || 0
                    }
                };
            }));

            return processedComments;
            
        } catch (error) {
            console.error(`Error fetching comments for file ${fileKey}:`, error);
            throw new Error(`Failed to fetch comments: ${error.message}`);
        }
    }

    // Post a new comment
    async postComment(fileKey, userId, commentData) {
        try {
            const client = await this.createAuthenticatedClient(userId);
            
            const payload = {
                message: commentData.message,
                client_meta: {
                    node_id: commentData.nodeId,
                    node_offset: {
                        x: commentData.position?.x || 0,
                        y: commentData.position?.y || 0
                    }
                }
            };

            if (commentData.parentId) {
                payload.parent_id = commentData.parentId;
            }

            const response = await client.post(`/files/${fileKey}/comments`, payload);
            
            return response.data;
            
        } catch (error) {
            console.error(`Error posting comment to file ${fileKey}:`, error);
            throw new Error(`Failed to post comment: ${error.message}`);
        }
    }

    // Resolve a comment
    async resolveComment(fileKey, commentId, userId) {
        try {
            const client = await this.createAuthenticatedClient(userId);
            
            const response = await client.delete(`/files/${fileKey}/comments/${commentId}`);
            
            return response.data;
            
        } catch (error) {
            console.error(`Error resolving comment ${commentId}:`, error);
            throw new Error(`Failed to resolve comment: ${error.message}`);
        }
    }

    // Get user's teams and projects
    async getUserTeams(userId) {
        try {
            const client = await this.createAuthenticatedClient(userId);
            
            const response = await client.get('/teams');
            
            return response.data.teams || [];
            
        } catch (error) {
            console.error(`Error fetching teams for user ${userId}:`, error);
            throw new Error(`Failed to fetch teams: ${error.message}`);
        }
    }

    // Get projects in a team
    async getTeamProjects(userId, teamId) {
        try {
            const client = await this.createAuthenticatedClient(userId);
            
            const response = await client.get(`/teams/${teamId}/projects`);
            
            return response.data.projects || [];
            
        } catch (error) {
            console.error(`Error fetching projects for team ${teamId}:`, error);
            throw new Error(`Failed to fetch projects: ${error.message}`);
        }
    }

    // Bulk sync comments for a file
    async syncFileComments(fileKey, userId) {
        try {
            console.log(`Starting comment sync for file ${fileKey}`);
            
            // Get current comments from database
            const existingComments = db.getCommentsByFileKey(fileKey);
            const existingCommentIds = new Set(existingComments.map(c => c.figma_comment_id));
            
            // Get comments from Figma API
            const comments = await this.getFileComments(fileKey, userId);
            const figmaCommentIds = new Set(comments.map(c => c.id));
            
            // Store each comment in database
            for (const comment of comments) {
                db.upsertComment({
                    figmaCommentId: comment.id,
                    figmaFileKey: fileKey,
                    nodeId: comment.node_id,
                    nodeName: comment.node_name,
                    message: comment.message,
                    authorName: comment.user?.name,
                    authorHandle: comment.user?.handle,
                    parentCommentId: comment.parent_id,
                    resolvedAt: comment.resolved_at ? new Date(comment.resolved_at) : null,
                    positionX: comment.position.x,
                    positionY: comment.position.y,
                    figmaCreatedAt: new Date(comment.created_at),
                    figmaUpdatedAt: comment.updated_at ? new Date(comment.updated_at) : null
                });
            }
            
            // Delete comments that no longer exist in Figma
            const commentsToDelete = existingCommentIds.size > 0 ? 
                Array.from(existingCommentIds).filter(id => !figmaCommentIds.has(id)) : [];
                
            let deletedCount = 0;
            for (const commentId of commentsToDelete) {
                db.deleteComment(commentId);
                deletedCount++;
                console.log(`Deleted comment ${commentId} (no longer exists in Figma)`);
            }

            // Update file last synced timestamp
            db.updateFileLastSynced(fileKey);
            
            const syncCommentWord = comments.length === 1 ? 'comment' : 'comments';
    const deletedCommentWord = deletedCount === 1 ? 'comment' : 'comments';
    console.log(`Synced ${comments.length} ${syncCommentWord} for file ${fileKey}${deletedCount > 0 ? `, deleted ${deletedCount} removed ${deletedCommentWord}` : ''}`);
            
            return {
                success: true,
                commentsCount: comments.length,
                deletedCount: deletedCount,
                syncedAt: new Date().toISOString()
            };
            
        } catch (error) {
            console.error(`Error syncing comments for file ${fileKey}:`, error);
            throw error;
        }
    }

    // Rate limiting helper
    async delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // Batch process with rate limiting
    async batchProcess(items, processFunc, batchSize = 5, delayMs = 1000) {
        const results = [];
        
        for (let i = 0; i < items.length; i += batchSize) {
            const batch = items.slice(i, i + batchSize);
            
            const batchPromises = batch.map(item => processFunc(item));
            const batchResults = await Promise.allSettled(batchPromises);
            
            results.push(...batchResults);
            
            // Delay between batches to respect rate limits
            if (i + batchSize < items.length) {
                await this.delay(delayMs);
            }
        }
        
        return results;
    }
}

module.exports = new FigmaAPI(); 