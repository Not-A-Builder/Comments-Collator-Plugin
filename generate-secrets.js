#!/usr/bin/env node

/**
 * Generate secure secrets for production deployment
 * Run: node generate-secrets.js
 */

const crypto = require('crypto');

function generateSecret(length = 32) {
    return crypto.randomBytes(length).toString('hex');
}

console.log('🔐 Generated Secure Secrets for Production:');
console.log('==========================================');
console.log('');
console.log('Copy these to your Railway environment variables:');
console.log('');
console.log(`WEBHOOK_SECRET=${generateSecret(32)}`);
console.log(`JWT_SECRET=${generateSecret(32)}`);
console.log('');
console.log('💡 Also remember to:');
console.log('1. Get your FIGMA_CLIENT_ID and FIGMA_CLIENT_SECRET from Figma Developer Console');
console.log('2. Update FIGMA_REDIRECT_URI with your Railway app URL');
console.log('3. Update API_BASE_URL with your Railway app URL');
console.log('4. Update ALLOWED_ORIGINS with your Railway app URL');
console.log('');
console.log('🚀 Your Railway app URL will be: https://your-app-name.railway.app');
console.log('   (Replace "your-app-name" with actual subdomain from Railway)'); 