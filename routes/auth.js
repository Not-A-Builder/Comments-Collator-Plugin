const express = require('express');
const axios = require('axios');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const crypto = require('crypto');
const db = require('../utils/database');

const router = express.Router();

// OAuth configuration
const FIGMA_OAUTH_URL = 'https://www.figma.com/oauth';
const FIGMA_TOKEN_URL = 'https://www.figma.com/api/oauth/token';
const FIGMA_USER_URL = 'https://api.figma.com/v1/me';

// Generate secure state parameter for OAuth
function generateState() {
    return crypto.randomBytes(32).toString('hex');
}

// Store state temporarily (in production, use Redis or database)
const stateStore = new Map();

// Initiate OAuth flow
router.get('/figma', (req, res) => {
    const state = generateState();
    const fileKey = req.query.file_key; // Optional file key for context
    
    // Store state with optional context
    stateStore.set(state, { 
        timestamp: Date.now(),
        fileKey: fileKey 
    });
    
    // Clean up old states (older than 10 minutes)
    for (const [key, value] of stateStore.entries()) {
        if (Date.now() - value.timestamp > 10 * 60 * 1000) {
            stateStore.delete(key);
        }
    }
    
    const params = new URLSearchParams({
        client_id: process.env.FIGMA_CLIENT_ID,
        redirect_uri: process.env.FIGMA_REDIRECT_URI,
        scope: 'file_read',
        state: state,
        response_type: 'code'
    });
    
    const authUrl = `${FIGMA_OAUTH_URL}?${params.toString()}`;
    res.redirect(authUrl);
});

// OAuth callback handler
router.get('/figma/callback', async (req, res) => {
    const { code, state } = req.query;
    
    if (!code || !state) {
        return res.status(400).send(`
            <!DOCTYPE html>
            <html>
            <head><title>Authentication Error</title></head>
            <body>
                <h1>Authentication Error</h1>
                <p>Missing authorization code or state parameter.</p>
                <a href="/auth/figma">Try again</a>
            </body>
            </html>
        `);
    }
    
    // Verify state parameter
    const storedState = stateStore.get(state);
    if (!storedState) {
        return res.status(400).send(`
            <!DOCTYPE html>
            <html>
            <head><title>Authentication Error</title></head>
            <body>
                <h1>Authentication Error</h1>
                <p>Invalid or expired state parameter.</p>
                <a href="/auth/figma">Try again</a>
            </body>
            </html>
        `);
    }
    
    stateStore.delete(state);
    
    try {
        // Exchange code for access token
        const tokenResponse = await axios.post(FIGMA_TOKEN_URL, {
            client_id: process.env.FIGMA_CLIENT_ID,
            client_secret: process.env.FIGMA_CLIENT_SECRET,
            redirect_uri: process.env.FIGMA_REDIRECT_URI,
            code: code,
            grant_type: 'authorization_code'
        });
        
        const { access_token, refresh_token, expires_in } = tokenResponse.data;
        
        // Get user information
        const userResponse = await axios.get(FIGMA_USER_URL, {
            headers: {
                'Authorization': `Bearer ${access_token}`
            }
        });
        
        const userData = userResponse.data;
        
        // Store user in database
        const expiresAt = new Date(Date.now() + (expires_in * 1000));
        const user = await db.upsertUser({
            figmaUserId: userData.id,
            email: userData.email,
            name: userData.name,
            handle: userData.handle,
            avatarUrl: userData.img_url,
            accessToken: access_token,
            refreshToken: refresh_token,
            tokenExpiresAt: expiresAt
        });
        
        // Generate JWT for plugin authentication
        const jwtToken = jwt.sign(
            { 
                userId: user.id,
                figmaUserId: userData.id,
                handle: userData.handle 
            },
            process.env.JWT_SECRET,
            { expiresIn: process.env.JWT_EXPIRES_IN || '24h' }
        );
        
        // Create session for plugin
        const sessionToken = crypto.randomBytes(32).toString('hex');
        await db.createPluginSession({
            userId: user.id,
            figmaFileKey: storedState.fileKey || 'unknown',
            sessionToken: sessionToken
        });
        
        // Return success page with token
        res.send(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>Authentication Successful</title>
                <style>
                    body { font-family: sans-serif; max-width: 600px; margin: 50px auto; padding: 20px; }
                    .success { color: #28a745; }
                    .token-box { background: #f8f9fa; padding: 15px; border-radius: 5px; margin: 20px 0; }
                    .copy-btn { background: #007bff; color: white; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer; }
                    .copy-btn:hover { background: #0056b3; }
                </style>
            </head>
            <body>
                <h1 class="success">✅ Authentication Successful!</h1>
                <p>Hello <strong>${userData.handle}</strong>! Your Figma account has been successfully connected.</p>
                
                <h3>Plugin Session Token:</h3>
                <div class="token-box">
                    <code id="session-token">${sessionToken}</code>
                    <button class="copy-btn" onclick="copyToken()">Copy Token</button>
                </div>
                
                <p><strong>Next steps:</strong></p>
                <ol>
                    <li>Copy the session token above</li>
                    <li>Return to your Figma plugin</li>
                    <li>Paste the token when prompted</li>
                    <li>Start using real comment integration!</li>
                </ol>
                
                <p><small>This token is valid for 24 hours and links your plugin to your authenticated Figma account.</small></p>
                
                <script>
                    function copyToken() {
                        const token = document.getElementById('session-token').textContent;
                        navigator.clipboard.writeText(token).then(() => {
                            alert('Token copied to clipboard!');
                        }).catch(() => {
                            // Fallback for older browsers
                            const textArea = document.createElement('textarea');
                            textArea.value = token;
                            document.body.appendChild(textArea);
                            textArea.select();
                            document.execCommand('copy');
                            document.body.removeChild(textArea);
                            alert('Token copied to clipboard!');
                        });
                    }
                </script>
            </body>
            </html>
        `);
        
    } catch (error) {
        console.error('OAuth callback error:', error);
        res.status(500).send(`
            <!DOCTYPE html>
            <html>
            <head><title>Authentication Error</title></head>
            <body>
                <h1>Authentication Error</h1>
                <p>Failed to complete authentication: ${error.message}</p>
                <a href="/auth/figma">Try again</a>
            </body>
            </html>
        `);
    }
});

// Verify session token endpoint
router.post('/verify', [
    body('session_token').notEmpty().withMessage('Session token is required')
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ 
            error: 'Validation Error',
            details: errors.array() 
        });
    }
    
    try {
        const { session_token } = req.body;
        const session = await db.getPluginSessionByToken(session_token);
        
        if (!session) {
            return res.status(401).json({
                error: 'Invalid session token'
            });
        }
        
        // Update last activity
        await db.updateSessionActivity(session_token);
        
        res.json({
            success: true,
            user: {
                id: session.user_id,
                handle: session.handle,
                name: session.name
            },
            fileKey: session.figma_file_key
        });
        
    } catch (error) {
        console.error('Token verification error:', error);
        res.status(500).json({
            error: 'Internal server error'
        });
    }
});

// Refresh token endpoint
router.post('/refresh', [
    body('refresh_token').notEmpty().withMessage('Refresh token is required')
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ 
            error: 'Validation Error',
            details: errors.array() 
        });
    }
    
    try {
        const { refresh_token } = req.body;
        
        // Exchange refresh token for new access token
        const tokenResponse = await axios.post(FIGMA_TOKEN_URL, {
            client_id: process.env.FIGMA_CLIENT_ID,
            client_secret: process.env.FIGMA_CLIENT_SECRET,
            refresh_token: refresh_token,
            grant_type: 'refresh_token'
        });
        
        const { access_token, refresh_token: new_refresh_token, expires_in } = tokenResponse.data;
        
        // Update user tokens in database
        const expiresAt = new Date(Date.now() + (expires_in * 1000));
        await db.updateUserTokens(refresh_token, {
            accessToken: access_token,
            refreshToken: new_refresh_token || refresh_token,
            tokenExpiresAt: expiresAt
        });
        
        res.json({
            success: true,
            access_token,
            expires_in
        });
        
    } catch (error) {
        console.error('Token refresh error:', error);
        res.status(500).json({
            error: 'Failed to refresh token'
        });
    }
});

module.exports = router; 