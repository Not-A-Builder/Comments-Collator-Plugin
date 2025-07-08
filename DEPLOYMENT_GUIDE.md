# 🚀 Free Deployment Guide - Railway

This guide will help you deploy your Comments Collator backend to Railway's free tier and publish your plugin to the Figma Plugin Store.

## Step 1: Deploy Backend to Railway (Free)

### 1.1 Sign up for Railway
1. Go to [railway.app](https://railway.app)
2. Click "Login" → "Login with GitHub"
3. Authorize Railway to access your GitHub account

### 1.2 Create New Project
1. Click "New Project" 
2. Select "Deploy from GitHub repo"
3. Choose this repository: `Comments-Collator-Plugin`
4. Click "Deploy Now"

Railway will automatically:
- Detect your Node.js app
- Install dependencies
- Run the build command (`npm run migrate`)
- Start your server

### 1.3 Configure Environment Variables
In your Railway dashboard:

1. Go to your project → "Variables" tab
2. Add these environment variables:

```
NODE_ENV=production
DATABASE_URL=./database/comments.db
FIGMA_CLIENT_ID=your_figma_client_id_here
FIGMA_CLIENT_SECRET=your_figma_client_secret_here
WEBHOOK_SECRET=secure_random_string_here
JWT_SECRET=another_secure_random_string_here
JWT_EXPIRES_IN=24h
API_BASE_URL=https://your-app-name.railway.app
FIGMA_API_BASE_URL=https://api.figma.com/v1
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=100
LOG_LEVEL=info
```

**Important:** 
- Replace `your_figma_client_id_here` and `your_figma_client_secret_here` with your actual Figma app credentials
- Generate secure random strings for `WEBHOOK_SECRET` and `JWT_SECRET` (use a password generator)
- Replace `your-app-name` with your actual Railway app subdomain

### 1.4 Get Your App URL
1. In Railway dashboard, go to "Settings" → "Domains"
2. Your app will be available at: `https://your-app-name.railway.app`
3. Test it: `https://your-app-name.railway.app/health`

## Step 2: Update Figma Developer App

### 2.1 Update OAuth Settings
1. Go to [Figma Developer Console](https://www.figma.com/developers/apps)
2. Select your existing app
3. Update the callback URL to: `https://your-app-name.railway.app/auth/figma/callback`
4. Add your production domain to allowed origins if needed

### 2.2 Configure CORS and Redirect URI
Add these environment variables in Railway (update the previous ones):

```
FIGMA_REDIRECT_URI=https://your-app-name.railway.app/auth/figma/callback
CORS_ORIGIN=https://www.figma.com
ALLOWED_ORIGINS=https://www.figma.com,https://your-app-name.railway.app
```

## Step 3: Update Plugin Code

### 3.1 Update Backend URL in Plugin
The plugin code needs to use your production URL instead of localhost.

**File:** `code.js` (line 2)
```javascript
// Change this line:
const BACKEND_URL = 'http://localhost:3000';

// To your Railway URL:
const BACKEND_URL = 'https://your-app-name.railway.app';
```

### 3.2 Test Production Backend
1. Update the code in Figma
2. Try the authentication flow
3. Verify comments sync correctly

## Step 4: Prepare Plugin for Store

### 4.1 Create Plugin Cover Image
Create a 400x300px cover image for your plugin:
- Use Figma to design it
- Export as PNG
- Show the plugin interface or comment collation feature
- Keep it clean and professional

### 4.2 Update Plugin Manifest
Ensure your `manifest.json` has:
```json
{
  "name": "Comments Collator",
  "id": "your-unique-plugin-id",
  "api": "1.0.0",
  "main": "code.js",
  "ui": "ui.html",
  "networkAccess": {
    "allowedDomains": ["https://your-app-name.railway.app"]
  },
  "permissions": ["currentuser"]
}
```

## Step 5: Submit to Figma Plugin Store

### 5.1 Prepare Submission
1. Go to [Figma Community](https://www.figma.com/community)
2. Click "Publish" → "Publish Plugin"
3. Upload your plugin files:
   - `manifest.json`
   - `code.js` 
   - `ui.html`
   - Cover image (400x300px)

### 5.2 Plugin Description
```
# Comments Collator

Transform scattered Figma comments into organized, actionable summaries directly on your canvas.

## Features
✅ **Real Comment Integration** - Syncs with actual Figma comments via OAuth
✅ **Interactive Checkboxes** - Mark comments as resolved with a click
✅ **Canvas Collation** - Generate visual comment summaries on your design
✅ **Theme Adaptive** - Works with light and dark Figma themes
✅ **Frame & Canvas Comments** - Handle both frame-specific and general comments

## How it works
1. Select any frame with comments
2. Authenticate with your Figma account (one-time setup)
3. Click "Add to Canvas" to create an interactive comment summary
4. Use checkboxes to mark comments as resolved
5. Comments sync back to Figma automatically

Perfect for design reviews, feedback collection, and keeping track of comment resolutions during the design process.
```

### 5.3 Submit for Review
1. Fill in plugin details
2. Add screenshots of the plugin in action
3. Submit for Figma's review process
4. Usually takes 2-7 days for approval

## Step 6: Free Tier Limits

**Railway Free Tier:**
- 500 hours/month (always-on for hobby projects)
- 1GB RAM
- 1GB storage
- Custom domain included
- No credit card required

This is perfect for your plugin's backend needs!

## Troubleshooting

### Railway Deployment Issues
- Check build logs in Railway dashboard
- Ensure all environment variables are set
- Verify your Node.js version (18.x)

### Authentication Issues
- Double-check Figma app redirect URI
- Verify environment variables match exactly
- Check CORS settings

### Plugin Store Rejection
- Ensure plugin works end-to-end
- Add proper error handling
- Include clear usage instructions

## Next Steps After Approval

1. **Monitor Usage**: Check Railway metrics
2. **User Feedback**: Respond to community comments
3. **Updates**: Push updates via Figma Community
4. **Scale**: Railway offers easy scaling if needed

---

🎉 **Congratulations!** Your plugin will be live and free on the Figma Plugin Store! 