#!/bin/bash

# Comments Collator Backend Startup Script
echo "🚀 Starting Comments Collator Backend..."

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js 16+ and try again."
    exit 1
fi

# Check if npm is installed
if ! command -v npm &> /dev/null; then
    echo "❌ npm is not installed. Please install npm and try again."
    exit 1
fi

# Check Node.js version
NODE_VERSION=$(node -v | sed 's/v//')
REQUIRED_VERSION="16.0.0"

if [ "$(printf '%s\n' "$REQUIRED_VERSION" "$NODE_VERSION" | sort -V | head -n1)" != "$REQUIRED_VERSION" ]; then
    echo "❌ Node.js version $NODE_VERSION is too old. Please install Node.js 16+ and try again."
    exit 1
fi

echo "✅ Node.js version $NODE_VERSION detected"

# Check if .env file exists
if [ ! -f ".env" ]; then
    echo "⚠️  .env file not found. Creating from template..."
    if [ -f "env.example" ]; then
        cp env.example .env
        echo "📝 .env file created from env.example"
        echo "⚙️  Please edit .env file with your Figma app credentials before continuing."
        echo ""
        echo "Required environment variables:"
        echo "  - FIGMA_CLIENT_ID (from Figma Developer Console)"
        echo "  - FIGMA_CLIENT_SECRET (from Figma Developer Console)"
        echo "  - WEBHOOK_SECRET (generate a strong random string)"
        echo "  - JWT_SECRET (generate a strong random string)"
        echo ""
        echo "Edit .env file and run this script again."
        exit 1
    else
        echo "❌ env.example file not found. Please create .env file manually."
        exit 1
    fi
fi

echo "✅ .env file found"

# Load environment variables
export $(grep -v '^#' .env | xargs)

# Validate required environment variables
REQUIRED_VARS=("FIGMA_CLIENT_ID" "FIGMA_CLIENT_SECRET" "WEBHOOK_SECRET" "JWT_SECRET")
MISSING_VARS=()

for var in "${REQUIRED_VARS[@]}"; do
    if [ -z "${!var}" ] || [ "${!var}" = "your_${var,,}_here" ]; then
        MISSING_VARS+=("$var")
    fi
done

if [ ${#MISSING_VARS[@]} -ne 0 ]; then
    echo "❌ Missing or invalid environment variables:"
    printf '  - %s\n' "${MISSING_VARS[@]}"
    echo ""
    echo "Please edit .env file and set these variables."
    exit 1
fi

echo "✅ Environment variables validated"

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
    echo "📦 Installing dependencies..."
    npm install
    if [ $? -ne 0 ]; then
        echo "❌ Failed to install dependencies"
        exit 1
    fi
    echo "✅ Dependencies installed"
else
    echo "✅ Dependencies already installed"
fi

# Create database directory if it doesn't exist
DB_DIR=$(dirname "${DATABASE_URL:-./database/comments.db}")
if [ ! -d "$DB_DIR" ]; then
    echo "📁 Creating database directory: $DB_DIR"
    mkdir -p "$DB_DIR"
fi

# Check if database exists, if not run migration
DB_PATH="${DATABASE_URL:-./database/comments.db}"
if [ ! -f "$DB_PATH" ]; then
    echo "🗄️  Database not found. Running migrations..."
    npm run migrate
    if [ $? -ne 0 ]; then
        echo "❌ Database migration failed"
        exit 1
    fi
    echo "✅ Database initialized"
else
    echo "✅ Database found"
fi

# Check if server is already running
PORT=${PORT:-3000}
if lsof -Pi :$PORT -sTCP:LISTEN -t >/dev/null; then
    echo "⚠️  Port $PORT is already in use. Please stop the existing server or change the PORT in .env"
    exit 1
fi

echo "✅ Port $PORT is available"

# Start the server
echo ""
echo "🎉 Starting backend server..."
echo "📍 Server URL: http://localhost:$PORT"
echo "🔐 OAuth Redirect: ${FIGMA_REDIRECT_URI:-http://localhost:3000/auth/figma/callback}"
echo ""
echo "Next steps:"
echo "1. Configure Figma Developer App with OAuth redirect URI"
echo "2. Set up webhooks (optional) for real-time updates"
echo "3. Open Figma plugin and connect to backend"
echo ""
echo "Press Ctrl+C to stop the server"
echo ""

# Run in development mode if NODE_ENV is not set to production
if [ "$NODE_ENV" = "production" ]; then
    npm start
else
    npm run dev
fi 