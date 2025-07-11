const express = require('express');
const axios = require('axios');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const crypto = require('crypto');
const Database = require('../utils/database');
const db = new Database();

const router = express.Router();

// OAuth configuration
const FIGMA_OAUTH_URL = 'https://www.figma.com/oauth';
const FIGMA_TOKEN_URL = 'https://api.figma.com/v1/oauth/token';
const FIGMA_USER_URL = 'https://api.figma.com/v1/me';

// Generate secure state parameter for OAuth
function generateState() {
    return crypto.randomBytes(32).toString('hex');
}

// Store state with fallback for database errors
const stateStore = new Map(); // Fallback in-memory store

// Get OAuth URL for plugin (returns JSON with URL instead of redirecting)
router.get('/get-oauth-url', (req, res) => {
    console.log(`🔗 OAuth URL requested - file_key: ${req.query.file_key}, IP: ${req.ip}`);
    
    const state = generateState();
    const fileKey = req.query.file_key;
    
    console.log(`🔑 Generated OAuth state for URL request: ${state.substring(0, 16)}...`);
    
    // Store state in database
    try {
        const result = db.run(
            `INSERT OR REPLACE INTO oauth_states (state, file_key, expires_at) 
             VALUES (?, ?, datetime('now', '+30 minutes'))`,
            [state, fileKey]
        );
        
        console.log(`✅ OAuth state stored for URL request: ${state.substring(0, 16)}..., changes: ${result.changes}`);
        
        // Build OAuth URL
        const params = new URLSearchParams({
            client_id: process.env.FIGMA_CLIENT_ID,
            redirect_uri: process.env.FIGMA_REDIRECT_URI,
            scope: 'file_read',
            state: state,
            response_type: 'code'
        });
        
        const authUrl = `${FIGMA_OAUTH_URL}?${params.toString()}`;
        console.log(`🌐 OAuth URL generated for plugin: ${authUrl.substring(0, 120)}...`);
        
        // Return URL as JSON instead of redirecting
        res.json({
            success: true,
            authUrl: authUrl,
            state: state.substring(0, 16) + '...',
            expiresIn: 30 * 60 // 30 minutes in seconds
        });
        
    } catch (error) {
        console.error('❌ Failed to store state for URL request:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to generate OAuth URL'
        });
    }
});

// Initiate OAuth flow (original endpoint for direct browser access)
router.get('/figma', (req, res) => {
    console.log(`🚀 OAuth initiation requested - file_key: ${req.query.file_key}, IP: ${req.ip}`);
    
    const state = generateState();
    const fileKey = req.query.file_key; // Optional file key for context
    
    console.log(`🔑 Generated OAuth state: ${state.substring(0, 16)}...`);
    console.log(`📁 File key: ${fileKey || 'none'}`);
    
    // Try to store state in database with fallback to memory
    const expiresAt = new Date(Date.now() + (30 * 60 * 1000));
    
    try {
        console.log(`💾 Attempting to store state in database...`);
        
        const result = db.run(
            `INSERT OR REPLACE INTO oauth_states (state, file_key, expires_at) 
             VALUES (?, ?, datetime('now', '+30 minutes'))`,
            [state, fileKey]
        );
        
        console.log(`📊 Database INSERT result:`, result);
        
        // Verify state was stored
        const verifyState = db.get(`SELECT * FROM oauth_states WHERE state = ?`, [state]);
        console.log(`✅ OAuth state stored in database: ${state.substring(0, 16)}..., verified: ${!!verifyState}`);
        
        if (verifyState) {
            console.log(`⏰ State expires at: ${verifyState.expires_at}, current time: ${db.get("SELECT datetime('now') as now").now}`);
            console.log(`🔍 Full stored state:`, verifyState);
        } else {
            console.error(`❌ State verification failed - state not found after INSERT`);
        }
        
        // Check total states in database
        const totalStates = db.get(`SELECT COUNT(*) as count FROM oauth_states`);
        console.log(`📊 Total states in database after storage: ${totalStates.count}`);
        
        // Clean up expired states
        const cleanupResult = db.run(`DELETE FROM oauth_states WHERE expires_at < datetime('now')`);
        console.log(`🧹 Cleaned up ${cleanupResult.changes} expired states`);
        
    } catch (error) {
        console.error('❌ CRITICAL: Failed to store state in database:', error);
        console.error('❌ Error stack:', error.stack);
        
        // Fallback to in-memory storage
        console.log(`💾 Using memory fallback for state storage...`);
        stateStore.set(state, {
            file_key: fileKey,
            expires_at: expiresAt
        });
        
        // Clean up expired memory states
        for (const [key, value] of stateStore.entries()) {
            if (new Date() > new Date(value.expires_at)) {
                stateStore.delete(key);
            }
        }
        
        console.log(`💾 OAuth state stored in memory: ${state.substring(0, 16)}..., total memory states: ${stateStore.size}`);
    }
    
    console.log(`🔗 Building OAuth redirect URL...`);
    
    const params = new URLSearchParams({
        client_id: process.env.FIGMA_CLIENT_ID,
        redirect_uri: process.env.FIGMA_REDIRECT_URI,
        scope: 'file_read',
        state: state,
        response_type: 'code'
    });
    
    const authUrl = `${FIGMA_OAUTH_URL}?${params.toString()}`;
    
    console.log(`🌐 OAuth URL generated: ${authUrl.substring(0, 120)}...`);
    console.log(`🏁 Sending redirect to Figma OAuth...`);
    
    res.redirect(authUrl);
    
    console.log(`✅ OAuth initiation completed for state: ${state.substring(0, 16)}...`);
});

// OAuth callback handler
router.get('/figma/callback', async (req, res) => {
    const { code, state } = req.query;
    
    console.log(`OAuth callback received: code=${code ? 'present' : 'missing'}, state=${state}`);
    
    if (!code || !state) {
        console.log('Missing code or state parameter');
        return res.status(400).send(`
            <!DOCTYPE html>
            <html>
            <head><title>Authentication Error</title></head>
            <body>
                <h1>Authentication Error</h1>
                <p>Missing authorization code or state parameter.</p>
                <p>Code: ${code ? 'Present' : 'Missing'}, State: ${state ? 'Present' : 'Missing'}</p>
                <a href="/auth/figma">Try again</a>
            </body>
            </html>
        `);
    }
    
    // Try to verify state from database first, then fallback to memory
    let storedState = null;
    
    try {
        // Clean up expired states first
        const cleanupResult = db.run(`DELETE FROM oauth_states WHERE expires_at < datetime('now')`);
        console.log(`🧹 Callback: Cleaned up ${cleanupResult.changes} expired states`);
        
        // Count total states before lookup
        const totalStates = db.get(`SELECT COUNT(*) as count FROM oauth_states`);
        console.log(`📊 Total states in database: ${totalStates.count}`);
        
        // Show current time and search details
        const currentTime = db.get("SELECT datetime('now') as now").now;
        console.log(`🔍 Looking for state: ${state.substring(0, 16)}..., current time: ${currentTime}`);
        
        // Check if state exists at all (regardless of expiration)
        const stateExists = db.get(`SELECT * FROM oauth_states WHERE state = ?`, [state]);
        console.log(`📋 State exists in table: ${!!stateExists}`);
        if (stateExists) {
            console.log(`⏰ State expires at: ${stateExists.expires_at}, is valid: ${stateExists.expires_at > currentTime}`);
        }
        
        // Verify state parameter from database
        storedState = db.get(
            `SELECT * FROM oauth_states WHERE state = ? AND expires_at > datetime('now')`,
            [state]
        );
        
        console.log(`🔍 Found valid state in database: ${!!storedState}`);
        
        if (storedState) {
            // Remove the used state from database
            const deleteResult = db.run(`DELETE FROM oauth_states WHERE state = ?`, [state]);
            console.log(`✅ State validated from database and removed: ${state}, deleted: ${deleteResult.changes} rows`);
        }
        
    } catch (error) {
        console.warn('⚠️  Failed to check state in database, checking memory fallback:', error.message);
    }
    
    // If not found in database, check memory fallback
    if (!storedState) {
        console.log(`🔍 State not found in database, checking memory fallback. Memory has ${stateStore.size} states`);
        const memoryState = stateStore.get(state);
        console.log(`🔍 Looking for state in memory: ${state}, found: ${!!memoryState}`);
        
        if (memoryState && new Date() <= new Date(memoryState.expires_at)) {
            storedState = {
                state: state,
                file_key: memoryState.file_key,
                expires_at: memoryState.expires_at
            };
            stateStore.delete(state);
            console.log(`✅ State validated from memory and removed: ${state}, remaining memory states: ${stateStore.size}`);
        } else if (memoryState) {
            console.log(`⏰ State found in memory but expired: ${state}`);
        }
    }
    
    // If state not found in either database or memory
    if (!storedState) {
        console.log(`❌ OAUTH ERROR: State parameter not found in database or memory: ${state}`);
        console.log(`📊 Final state: Database states: ${db.get('SELECT COUNT(*) as count FROM oauth_states').count}, Memory states: ${stateStore.size}`);
        console.log(`🔍 All memory state keys: [${Array.from(stateStore.keys()).join(', ')}]`);
        
        return res.status(400).send(`
            <!DOCTYPE html>
            <html>
            <head><title>Authentication Error</title></head>
            <body>
                <h1>Authentication Error</h1>
                <p>Invalid or expired state parameter.</p>
                <p>This usually happens if you took too long to complete the OAuth flow or if you're using an old link.</p>
                <p><strong>Debug info:</strong> State ${state} not found in storage</p>
                <a href="/auth/figma">Try again with a fresh link</a>
            </body>
            </html>
        `);
    }
    
    try {
        console.log('Exchanging authorization code for access token...');
        // Exchange code for access token
        const tokenResponse = await axios.post(FIGMA_TOKEN_URL, {
            client_id: process.env.FIGMA_CLIENT_ID,
            client_secret: process.env.FIGMA_CLIENT_SECRET,
            redirect_uri: process.env.FIGMA_REDIRECT_URI,
            code: code,
            grant_type: 'authorization_code'
        });
        
        const { access_token, refresh_token, expires_in } = tokenResponse.data;
        console.log('Access token received successfully');
        
        // Get user information
        console.log('Fetching user information from Figma...');
        const userResponse = await axios.get(FIGMA_USER_URL, {
            headers: {
                'Authorization': `Bearer ${access_token}`
            }
        });
        
        const userData = userResponse.data;
        console.log(`User authenticated: ${userData.handle} (${userData.email})`);
        
        // Store user in database
        const expiresAt = new Date(Date.now() + (expires_in * 1000));
        const user = db.upsertUser({
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
        db.createPluginSession({
            userId: user.id,
            figmaFileKey: storedState.file_key || null,
            sessionToken: sessionToken
        });
        
        console.log(`Plugin session created: ${sessionToken.substring(0, 8)}...`);
        
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
        console.error('Error details:', {
            message: error.message,
            response: error.response?.data,
            status: error.response?.status
        });
        res.status(500).send(`
            <!DOCTYPE html>
            <html>
            <head><title>Authentication Error</title></head>
            <body>
                <h1>Authentication Error</h1>
                <p>Failed to complete authentication: ${error.message}</p>
                <p>Status: ${error.response?.status || 'Unknown'}</p>
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
        const session = db.getPluginSessionByToken(session_token);
        
        if (!session) {
            return res.status(401).json({
                error: 'Invalid session token'
            });
        }
        
        // Update last activity
        db.updateSessionActivity(session_token);
        
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
        db.updateUserTokens(refresh_token, {
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

// Check for existing valid session for the current file
router.get('/check-session', async (req, res) => {
    try {
        const { file_key } = req.query;
        
        if (!file_key) {
            return res.status(400).json({
                error: 'File key is required'
            });
        }
        
        // Find the most recent valid session for this file or any file from the same user
        const sql = `
            SELECT ps.*, u.figma_user_id, u.name, u.handle, u.email
            FROM plugin_sessions ps
            JOIN users u ON ps.user_id = u.id
            WHERE (ps.figma_file_key = ? OR ps.figma_file_key IS NULL)
            AND ps.created_at > datetime('now', '-24 hours')
            AND u.access_token IS NOT NULL
            AND (u.token_expires_at IS NULL OR datetime(u.token_expires_at/1000, 'unixepoch') > datetime('now'))
            ORDER BY ps.last_activity_at DESC
            LIMIT 1
        `;
        
        const session = db.get(sql, [file_key]);
        
        if (session) {
            // Update session activity
            db.updateSessionActivity(session.session_token);
            
            console.log(`Auto-detected existing session for ${session.handle}`);
            
            res.json({
                success: true,
                hasValidSession: true,
                session: {
                    token: session.session_token,
                    user: {
                        id: session.user_id,
                        handle: session.handle,
                        name: session.name
                    },
                    fileKey: session.figma_file_key
                }
            });
        } else {
            res.json({
                success: true,
                hasValidSession: false
            });
        }
        
    } catch (error) {
        console.error('Error checking for existing session:', error);
        res.status(500).json({
            error: 'Failed to check for existing session'
        });
    }
});







// DEBUG: Test database connection
router.get('/debug-db', (req, res) => {
    try {
        // Test basic database connectivity
        const testResult = db.get('SELECT 1 as test');
        console.log('🧪 Database test result:', testResult);
        
        // Test oauth_states table specifically
        const tableExists = db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='oauth_states'");
        console.log('🧪 OAuth states table exists:', !!tableExists);
        
        // Try a simple insert and delete test
        const testState = 'test-' + Date.now();
        console.log('🧪 Testing INSERT with state:', testState);
        
        const insertResult = db.run(
            `INSERT INTO oauth_states (state, file_key, expires_at) VALUES (?, ?, datetime('now', '+1 minute'))`,
            [testState, 'test-file']
        );
        console.log('🧪 INSERT result:', insertResult);
        
        const retrieveResult = db.get(`SELECT * FROM oauth_states WHERE state = ?`, [testState]);
        console.log('🧪 Retrieved state:', retrieveResult);
        
        const deleteResult = db.run(`DELETE FROM oauth_states WHERE state = ?`, [testState]);
        console.log('🧪 DELETE result:', deleteResult);
        
        res.json({
            success: true,
            database: {
                connected: !!testResult,
                oauth_states_table_exists: !!tableExists,
                insert_test: !!insertResult,
                retrieve_test: !!retrieveResult,
                delete_test: deleteResult.changes > 0
            },
            environment: {
                figma_client_id: !!process.env.FIGMA_CLIENT_ID,
                figma_redirect_uri: process.env.FIGMA_REDIRECT_URI,
                database_url: process.env.DATABASE_URL || './database/comments.db'
            }
        });
        
    } catch (error) {
        console.error('🧪 Database test failed:', error);
        res.status(500).json({
            error: 'Database test failed',
            message: error.message,
            stack: error.stack
        });
    }
});

// DEBUG: Simple OAuth test endpoint  
router.get('/test-oauth-flow', (req, res) => {
    const state = generateState();
    console.log(`🧪 TEST: Generated state: ${state.substring(0, 16)}...`);
    
    try {
        // Try to store state
        const result = db.run(
            `INSERT OR REPLACE INTO oauth_states (state, file_key, expires_at) 
             VALUES (?, ?, datetime('now', '+30 minutes'))`,
            [state, 'test-manual']
        );
        
        console.log(`🧪 TEST: Storage result:`, result);
        
        // Verify it was stored
        const verify = db.get(`SELECT * FROM oauth_states WHERE state = ?`, [state]);
        console.log(`🧪 TEST: Verification:`, !!verify);
        
        res.json({
            success: true,
            generatedState: state,
            stored: !!result,
            verified: !!verify,
            allStates: db.all(`SELECT state, file_key, created_at, expires_at FROM oauth_states ORDER BY created_at DESC LIMIT 5`)
        });
        
    } catch (error) {
        console.error(`🧪 TEST ERROR:`, error);
        res.status(500).json({ error: error.message });
    }
});

// DEBUG: Real-time OAuth state diagnostics (temporary)
router.get('/debug-states', (req, res) => {
    try {
        // Get all current states
        const allStates = db.all(`SELECT * FROM oauth_states ORDER BY created_at DESC`);
        const currentTime = db.get("SELECT datetime('now') as now").now;
        
        // Check memory states
        const memoryStates = Array.from(stateStore.entries()).map(([key, value]) => ({
            state: key,
            file_key: value.file_key,
            expires_at: value.expires_at,
            expired: new Date() > new Date(value.expires_at)
        }));
        
        // Count expired vs valid states
        const validDbStates = allStates.filter(s => s.expires_at > currentTime);
        const expiredDbStates = allStates.filter(s => s.expires_at <= currentTime);
        
        res.json({
            currentTime: currentTime,
            database: {
                total: allStates.length,
                valid: validDbStates.length,
                expired: expiredDbStates.length,
                states: allStates.map(s => ({
                    state: s.state.substring(0, 16) + '...',
                    file_key: s.file_key,
                    created_at: s.created_at,
                    expires_at: s.expires_at,
                    isValid: s.expires_at > currentTime
                }))
            },
            memory: {
                total: memoryStates.length,
                states: memoryStates.map(s => ({
                    state: s.state.substring(0, 16) + '...',
                    file_key: s.file_key,
                    expires_at: s.expires_at,
                    expired: s.expired
                }))
            }
        });
        
    } catch (error) {
        res.status(500).json({
            error: error.message,
            stack: error.stack
        });
    }
});

module.exports = router; 