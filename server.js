const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const authRoutes = require('./routes/auth');
const webhookRoutes = require('./routes/webhooks');
const apiRoutes = require('./routes/api');
const commentsRoutes = require('./routes/comments');

const app = express();
const port = process.env.PORT || 3000;

// Security middleware
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", "data:", "https:"],
            connectSrc: ["'self'", "https://api.figma.com"]
        }
    }
}));

// CORS configuration
const corsOptions = {
    origin: function (origin, callback) {
        const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:8080'];
        
        // Allow requests with no origin or "null" origin (mobile apps, curl, OAuth redirects, Figma plugins)
        if (!origin || origin === 'null') {
            return callback(null, true);
        }
        
        // Allow configured origins
        if (allowedOrigins.indexOf(origin) !== -1) {
            callback(null, true);
        } else {
            console.log(`CORS blocked origin: ${origin}, allowed: ${allowedOrigins.join(', ')}`);
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-figma-webhook-signature']
};

app.use(cors(corsOptions));
app.use(compression());

// Rate limiting
const limiter = rateLimit({
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000, // 15 minutes
    max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100, // limit each IP to 100 requests per windowMs
    message: {
        error: 'Too many requests from this IP, please try again later.'
    },
    standardHeaders: true,
    legacyHeaders: false,
});

app.use('/api/', limiter);

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Health check endpoint
app.get('/health', (req, res) => {
    res.status(200).json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        version: '1.0.0'
    });
});

// Routes
app.use('/auth', authRoutes);
app.use('/webhooks', webhookRoutes);
app.use('/api', apiRoutes);
app.use('/api/comments', commentsRoutes);

// Serve static files (for OAuth redirect pages)
app.use('/static', express.static('public'));

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Error:', err);
    
    if (err.name === 'ValidationError') {
        return res.status(400).json({
            error: 'Validation Error',
            details: err.message
        });
    }
    
    if (err.name === 'UnauthorizedError') {
        return res.status(401).json({
            error: 'Unauthorized',
            message: 'Invalid or expired token'
        });
    }
    
    res.status(500).json({
        error: 'Internal Server Error',
        message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
    });
});

// 404 handler
app.use('*', (req, res) => {
    res.status(404).json({
        error: 'Not Found',
        message: 'The requested resource was not found'
    });
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('SIGTERM received, shutting down gracefully');
    process.exit(0);
});

process.on('SIGINT', () => {
    console.log('SIGINT received, shutting down gracefully');
    process.exit(0);
});

// Test database connection on startup
const Database = require('./utils/database');
const db = new Database();

// Ensure OAuth states table exists at startup
function ensureOAuthTable() {
    try {
        // Create oauth_states table if it doesn't exist
        const createTableSQL = `
            CREATE TABLE IF NOT EXISTS oauth_states (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                state TEXT UNIQUE NOT NULL,
                file_key TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                expires_at DATETIME NOT NULL
            )
        `;
        
        db.run(createTableSQL);
        
        // Create index if it doesn't exist
        const createIndexSQL = `
            CREATE INDEX IF NOT EXISTS idx_oauth_states_state ON oauth_states (state)
        `;
        
        db.run(createIndexSQL);
        
        // Test the table works
        const testResult = db.get("SELECT COUNT(*) as count FROM oauth_states");
        console.log('✅ OAuth states table created/verified successfully');
        return true;
        
    } catch (error) {
        console.error('❌ Failed to create OAuth states table:', error.message);
        return false;
    }
}

// Start server
app.listen(port, '0.0.0.0', () => {
    console.log(`🚀 Comments Collator Backend Server running on port ${port}`);
    console.log(`📊 Health check: http://localhost:${port}/health`);
    console.log(`🔐 OAuth endpoint: http://localhost:${port}/auth/figma`);
    console.log(`📨 Webhook endpoint: http://localhost:${port}/webhooks/figma`);
    console.log(`📡 API endpoint: http://localhost:${port}/api`);
    console.log(`💾 Database: ${process.env.DATABASE_URL || './database/comments.db'}`);
    console.log(`🔧 Using better-sqlite3 for improved compatibility`);
    
    // Test database connection
    try {
        const testResult = db.get('SELECT 1 as test');
        console.log('✅ Database connection test successful (better-sqlite3)');
        
        // Ensure OAuth states table exists
        const oauthTableExists = ensureOAuthTable();
        if (oauthTableExists) {
            console.log('✅ OAuth states table ready for use');
        } else {
            console.warn('⚠️  OAuth states table creation failed - using memory fallback');
        }
        
    } catch (error) {
        console.error('❌ Database connection failed:', error.message);
        console.warn('⚠️  Using memory-only fallback for OAuth states');
    }
});

module.exports = app; 