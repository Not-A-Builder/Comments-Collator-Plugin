# Comments Collator - Real Backend Integration

A Figma plugin that collates comments from selected frames with **real comment integration** via backend server, webhooks, and OAuth authentication.

## ✨ Features

### Real Comment Integration
- **🔐 OAuth Authentication**: Secure Figma OAuth flow
- **🔄 Real-time Sync**: Webhook-based comment synchronization
- **💾 Database Storage**: Persistent comment data with SQLite
- **🛡️ Permission Management**: User access control and file permissions
- **⚡ Live Updates**: Comments sync automatically when modified

### Plugin Functionality
- **📝 Comment Collation**: Create visual comment summaries on canvas
- **✅ Interactive Checkboxes**: Mark comments as resolved/unresolved
- **🎨 Theme Awareness**: Adapts to Figma's light/dark themes
- **🔍 Frame Selection**: Automatically detects and displays frame comments
- **📊 Comment Management**: View, filter, and manage comment states

## 🏗️ Architecture

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

## 🚀 Quick Start

### Backend Setup
1. **Install Dependencies**:
   ```bash
   npm install
   ```

2. **Configure Environment**:
   ```bash
   cp env.example .env
   # Edit .env with your Figma app credentials
   ```

3. **Initialize Database**:
   ```bash
   npm run migrate
   ```

4. **Start Backend Server**:
   ```bash
   npm run dev
   # Server runs on http://localhost:3000
   ```

### Plugin Installation
1. Open Figma → Plugins → Development → Import plugin from manifest
2. Select `manifest.json` from this repository
3. Plugin appears in your Figma plugins list

## 📖 Usage Guide

### 1. Authentication
1. **Open Plugin**: Launch "Comments Collator" in Figma
2. **Connect Backend**: Click "Connect to Backend"
3. **Authenticate**: Click "Authenticate with Figma"
4. **Complete OAuth**: Browser opens → authorize app → copy session token
5. **Connect**: Paste session token in plugin → click "Connect"

### 2. View Comments
1. **Select Frame**: Click on any frame in your Figma file
2. **View Comments**: Plugin automatically loads real comments for that frame
3. **Comment Details**: See author, timestamp, resolved status, and full message

### 3. Collate to Canvas
1. **Create Collation**: Click "Collate Comments to Canvas"
2. **Interactive Elements**: Generated frame includes:
   - Clickable checkboxes for each comment
   - Author names and timestamps
   - Resolved/active status indicators
   - Theme-appropriate styling

### 4. Manage Comments
1. **Toggle Status**: Click checkboxes to mark resolved/unresolved
2. **Sync Comments**: Click "🔄 Sync Comments" to refresh from backend
3. **Real-time Updates**: Changes sync back to Figma via API

## 🛠️ Development

### Backend Components

**Server** (`server.js`)
- Express.js application with middleware setup
- CORS, security, and rate limiting configured
- Route mounting for auth, API, webhooks, and comments

**Authentication** (`routes/auth.js`)
- OAuth 2.0 flow implementation
- Session token generation and validation
- User profile management

**API Routes** (`routes/api.js`)
- File and user management endpoints
- Session tracking and node selection
- Permission validation and statistics

**Comment Management** (`routes/comments.js`)
- Comment CRUD operations
- Thread management and resolution
- Summary and filtering capabilities

**Webhook Handling** (`routes/webhooks.js`)
- Real-time comment event processing
- Signature verification for security
- Database synchronization

**Database Layer** (`utils/database.js`)
- SQLite operations with prepared statements
- User, file, comment, and session management
- Permission and audit trail handling

**Figma API Client** (`utils/figma-api.js`)
- Authenticated requests to Figma REST API
- Token refresh and error handling
- File and comment synchronization

### Frontend Components

**Plugin Core** (`code.js`)
- Session management and authentication
- Backend API communication
- Comment fetching and canvas rendering
- Interactive checkbox handling

**User Interface** (`ui.html`)
- Authentication flow UI
- Comment display and management
- Status indicators and error handling
- Responsive design with theme support

## 🔧 Configuration

### Environment Variables
```bash
# Server Configuration
PORT=3000
NODE_ENV=development

# Database
DATABASE_URL=./database/comments.db

# Figma OAuth
FIGMA_CLIENT_ID=your_figma_client_id
FIGMA_CLIENT_SECRET=your_figma_client_secret
FIGMA_REDIRECT_URI=http://localhost:3000/auth/figma/callback

# Security
WEBHOOK_SECRET=your_webhook_secret
JWT_SECRET=your_jwt_secret
CORS_ORIGIN=http://localhost:8080
```

### Figma App Setup
1. Create app at https://www.figma.com/developers/apps
2. Configure OAuth redirect URI
3. Set up webhooks for real-time updates
4. Note client ID and secret for environment

## 📊 API Endpoints

### Authentication
- `GET /auth/figma` - Initiate OAuth flow
- `GET /auth/figma/callback` - OAuth callback handler
- `POST /auth/verify` - Verify session token

### Comments
- `GET /api/comments/:fileKey` - Get comments for file/node
- `POST /api/comments/:fileKey` - Create new comment
- `PUT /api/comments/:fileKey/:commentId/resolve` - Toggle resolution
- `GET /api/comments/:fileKey/summary` - Comment statistics

### Files & Users
- `GET /api/files/:fileKey` - File information
- `POST /api/files/:fileKey/sync` - Sync comments from Figma
- `GET /api/user/profile` - Current user profile
- `GET /api/user/files` - Accessible files

### Webhooks
- `POST /webhooks/figma` - Figma webhook endpoint
- `GET /webhooks/health` - Webhook health check

## 🚀 Deployment

### Quick Deploy (Heroku)
```bash
# Create Heroku app
heroku create your-app-name

# Set environment variables
heroku config:set FIGMA_CLIENT_ID=your_id
heroku config:set FIGMA_CLIENT_SECRET=your_secret
# ... (set all required env vars)

# Deploy
git push heroku main
heroku run npm run migrate
```

### Production Considerations
- **HTTPS Required**: For webhooks and OAuth
- **Database**: Consider PostgreSQL for scale
- **Monitoring**: Application and webhook delivery logs
- **Security**: Rate limiting, CORS, token validation
- **Backups**: Regular database and configuration backups

See [DEPLOYMENT.md](DEPLOYMENT.md) for comprehensive deployment guide.

## 🐛 Troubleshooting

### Common Issues

**Authentication Failures**
- Verify Figma app client ID/secret
- Check OAuth redirect URI matches exactly
- Ensure backend server is accessible

**Webhook Issues**
- Confirm HTTPS endpoint for webhooks
- Verify webhook secret matches Figma configuration
- Check webhook signature validation

**Comment Sync Problems**
- Validate user has file access permissions
- Check Figma API rate limits
- Verify database connectivity

**Plugin Connection Errors**
- Confirm backend URL in `code.js`
- Check network access permissions in `manifest.json`
- Verify CORS configuration

### Debug Mode
```bash
NODE_ENV=development npm start
```

## 🔒 Security

- **OAuth 2.0**: Secure Figma authentication
- **JWT Tokens**: Session management with expiration
- **Webhook Signatures**: Verified for authenticity
- **CORS Protection**: Restricted origins
- **Rate Limiting**: API endpoint protection
- **Input Validation**: All user inputs sanitized

## 📄 License

MIT License - see [LICENSE](LICENSE) file for details.

## 🤝 Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📞 Support

- **Issues**: [GitHub Issues](https://github.com/your-repo/issues)
- **Documentation**: [Deployment Guide](DEPLOYMENT.md)
- **API Reference**: See API Endpoints section above

---

**Real comment integration requires:**
- ✅ Backend server (Node.js/Express)
- ✅ Database (SQLite/PostgreSQL)
- ✅ OAuth authentication flow
- ✅ Webhook infrastructure
- ✅ Figma Developer App

**This implementation provides all components for production-ready comment integration.** 