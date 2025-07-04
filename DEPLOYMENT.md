# Comments Collator - Real Backend Deployment Guide

This guide covers deploying the full-stack Comments Collator system with real Figma comment integration.

## Architecture Overview

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│  Figma Plugin   │◄──►│  Backend Server  │◄──►│ Figma REST API  │
│  (Frontend)     │    │  (Express.js)    │    │   (OAuth)       │
└─────────────────┘    └──────────────────┘    └─────────────────┘
                              │
                              ▼
                       ┌──────────────────┐
                       │ SQLite Database  │
                       │ (Comments Store) │
                       └──────────────────┘
                              ▲
                              │
                       ┌──────────────────┐
                       │ Figma Webhooks   │
                       │ (Real-time sync) │
                       └──────────────────┘
```

## Prerequisites

- Node.js 16+ installed
- Figma Developer App configured
- Public URL for webhook endpoint (ngrok, Heroku, etc.)

## Step 1: Figma Developer App Setup

1. **Create Figma App**:
   - Go to https://www.figma.com/developers/apps
   - Click "Create new app"
   - Choose "Plugin" as app type

2. **Configure OAuth**:
   - Set OAuth redirect URI: `http://localhost:3000/auth/figma/callback`
   - Note down your `CLIENT_ID` and `CLIENT_SECRET`

3. **Configure Webhooks** (if available):
   - Set webhook endpoint: `https://your-domain.com/webhooks/figma`
   - Subscribe to `FILE_COMMENT` events

## Step 2: Environment Setup

1. **Clone and Install**:
```bash
# Install dependencies
npm install

# Create environment file
cp env.example .env
```

2. **Configure Environment Variables**:
```bash
# Server Configuration
PORT=3000
NODE_ENV=production

# Database Configuration
DATABASE_URL=./database/comments.db

# Figma OAuth Configuration
FIGMA_CLIENT_ID=your_figma_client_id_here
FIGMA_CLIENT_SECRET=your_figma_client_secret_here
FIGMA_REDIRECT_URI=http://localhost:3000/auth/figma/callback

# Webhook Configuration
WEBHOOK_SECRET=your_strong_webhook_secret_here

# JWT Configuration
JWT_SECRET=your_strong_jwt_secret_here
JWT_EXPIRES_IN=24h

# Security
CORS_ORIGIN=http://localhost:8080
ALLOWED_ORIGINS=http://localhost:8080,https://www.figma.com
```

## Step 3: Database Setup

```bash
# Initialize database
npm run migrate
```

This creates the SQLite database with all necessary tables:
- `users` - Authenticated Figma users
- `files` - Tracked Figma files
- `comments` - Synced comment data
- `webhook_events` - Webhook delivery log
- `file_permissions` - Access control
- `plugin_sessions` - Active plugin sessions

## Step 4: Backend Deployment

### Local Development
```bash
# Start development server
npm run dev

# Server starts on http://localhost:3000
```

### Production Deployment (Heroku)

1. **Setup Heroku**:
```bash
# Install Heroku CLI and login
heroku create comments-collator-backend

# Set environment variables
heroku config:set FIGMA_CLIENT_ID=your_client_id
heroku config:set FIGMA_CLIENT_SECRET=your_client_secret
heroku config:set FIGMA_REDIRECT_URI=https://your-app.herokuapp.com/auth/figma/callback
heroku config:set WEBHOOK_SECRET=your_webhook_secret
heroku config:set JWT_SECRET=your_jwt_secret
heroku config:set NODE_ENV=production

# Deploy
git push heroku main
```

2. **Initialize Database**:
```bash
heroku run npm run migrate
```

### Production Deployment (VPS/DigitalOcean)

1. **Setup Server**:
```bash
# Upload code to server
scp -r . user@server:/opt/comments-collator/

# Install dependencies
cd /opt/comments-collator
npm install --production

# Setup PM2 for process management
npm install -g pm2
pm2 start server.js --name comments-collator

# Setup reverse proxy (nginx)
# Point domain to port 3000
```

2. **Configure SSL** (required for webhooks):
```bash
# Install certbot
sudo apt install certbot python3-certbot-nginx

# Get SSL certificate
sudo certbot --nginx -d your-domain.com
```

## Step 5: Webhook Configuration

### Using ngrok (Development)
```bash
# Install ngrok
npm install -g ngrok

# Expose local server
ngrok http 3000

# Use the https URL for webhooks: https://abc123.ngrok.io/webhooks/figma
```

### Production Webhooks
- Ensure your server has a public HTTPS endpoint
- Configure webhook URL in Figma Developer Console
- Verify webhook signature validation is working

## Step 6: Plugin Configuration

Update the plugin's `code.js` file:

```javascript
// Update backend URL for production
const BACKEND_URL = 'https://your-backend-domain.com';
```

## Step 7: Testing the Integration

### 1. Test Backend Health
```bash
curl http://localhost:3000/health
```

### 2. Test OAuth Flow
1. Open plugin in Figma
2. Click "Connect to Backend"
3. Click "Authenticate with Figma"
4. Complete OAuth flow
5. Copy session token back to plugin

### 3. Test Comment Sync
1. Add comments to a Figma frame
2. Select the frame in plugin
3. Click "Sync Comments"
4. Verify real comments appear

### 4. Test Webhook Delivery (if configured)
```bash
# Test webhook endpoint
curl -X POST http://localhost:3000/webhooks/test \
  -H "Content-Type: application/json" \
  -d '{
    "event_type": "FILE_COMMENT",
    "file_key": "test",
    "comment": {
      "id": "test-comment",
      "message": "Test comment"
    }
  }'
```

## API Endpoints

### Authentication
- `GET /auth/figma` - Initiate OAuth flow
- `GET /auth/figma/callback` - OAuth callback
- `POST /auth/verify` - Verify session token

### Comments
- `GET /api/comments/:fileKey` - Get comments for file
- `POST /api/comments/:fileKey` - Post new comment
- `PUT /api/comments/:fileKey/:commentId/resolve` - Resolve comment

### Files
- `GET /api/files/:fileKey` - Get file info
- `POST /api/files/:fileKey/sync` - Sync comments from Figma

### Webhooks
- `POST /webhooks/figma` - Figma webhook endpoint
- `GET /webhooks/health` - Webhook health check

## Security Considerations

1. **Environment Variables**: Never commit secrets to git
2. **HTTPS**: Required for webhooks and OAuth
3. **CORS**: Properly configure allowed origins
4. **Rate Limiting**: Implemented for API endpoints
5. **Webhook Signatures**: Verified for authenticity
6. **Token Expiration**: JWT tokens expire after 24h

## Monitoring and Logs

### Application Logs
```bash
# View logs (PM2)
pm2 logs comments-collator

# View logs (Heroku)
heroku logs --tail
```

### Database Monitoring
```bash
# Check comment sync status
sqlite3 database/comments.db "SELECT COUNT(*) FROM comments;"

# Check webhook events
sqlite3 database/comments.db "SELECT event_type, COUNT(*) FROM webhook_events GROUP BY event_type;"

# Check active users
sqlite3 database/comments.db "SELECT COUNT(*) FROM plugin_sessions WHERE last_activity_at > datetime('now', '-1 hour');"
```

## Troubleshooting

### Common Issues

1. **OAuth Redirect Mismatch**:
   - Verify `FIGMA_REDIRECT_URI` matches Figma app settings
   - Check for trailing slashes

2. **Webhook Signature Validation Failed**:
   - Verify `WEBHOOK_SECRET` matches Figma webhook configuration
   - Check request body parsing order

3. **CORS Errors**:
   - Add Figma domain to `ALLOWED_ORIGINS`
   - Verify plugin manifest has correct permissions

4. **Database Connection Issues**:
   - Check file permissions for SQLite database
   - Run migrations: `npm run migrate`

### Debug Mode
```bash
# Enable debug logging
NODE_ENV=development npm start
```

## Scaling Considerations

### Database
- For high-volume usage, consider PostgreSQL
- Implement connection pooling
- Add database indexes for performance

### Caching
- Redis for session storage
- Cache frequently accessed comments
- Rate limiting per user

### Load Balancing
- Multiple backend instances
- Session affinity for WebSocket connections
- Database read replicas

## Backup and Recovery

### Database Backup
```bash
# Backup SQLite database
cp database/comments.db backup/comments-$(date +%Y%m%d).db

# Automated backup script
0 2 * * * /path/to/backup-script.sh
```

### Configuration Backup
- Store environment variables in secure vault
- Document all Figma app configurations
- Keep deployment scripts in version control

## Support and Maintenance

### Regular Tasks
- Monitor webhook delivery rates
- Clean up old session tokens
- Update dependencies regularly
- Review access logs for security

### Performance Monitoring
- API response times
- Database query performance
- Memory and CPU usage
- Comment sync success rates

---

## Production Checklist

- [ ] Figma Developer App created and configured
- [ ] Environment variables set securely
- [ ] Database migrated and tested
- [ ] SSL certificate installed
- [ ] Webhook endpoint configured and tested
- [ ] OAuth flow tested end-to-end
- [ ] Comment sync verified working
- [ ] Monitoring and logging configured
- [ ] Backup strategy implemented
- [ ] Security review completed

For additional support, check the [troubleshooting guide](TROUBLESHOOTING.md) or open an issue. 