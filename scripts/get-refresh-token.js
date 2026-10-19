// scripts/get-refresh-token.js
// Run this ONCE, locally, to obtain a Gmail API refresh token for the cron script.
//
// Usage:
//   npm run auth
//   - or -
//   node scripts/get-refresh-token.js
//
// Spins up a temporary local HTTP server on port 3000, opens the consent URL,
// and automatically captures the auth code when Google redirects back.
// Copy the printed GOOGLE_REFRESH_TOKEN=... line into your .env file.
//
// NOTE: The OOB (urn:ietf:wg:oauth:2.0:oob) redirect was blocked by Google in
// Oct 2022. This script uses the loopback redirect (http://localhost:3000/callback)
// which requires "http://localhost:3000/callback" to be added as an Authorized
// Redirect URI in your Google Cloud Console OAuth 2.0 Client settings.

'use strict';

require('dotenv').config();
const { google } = require('googleapis');
const http       = require('http');
const url        = require('url');

const PORT          = 3000;
const REDIRECT_URI  = `http://localhost:${PORT}/callback`;

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  REDIRECT_URI,
);

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.modify',
];

const authUrl = oauth2Client.generateAuthUrl({
  access_type: 'offline',
  prompt: 'consent', // forces refresh_token to be returned every time
  scope: SCOPES,
});

console.log('\n=== Gmail OAuth2 Refresh Token Generator ===\n');
console.log('STEP 1 — Make sure the following URI is listed under');
console.log('         "Authorized redirect URIs" in Google Cloud Console');
console.log(`         OAuth 2.0 Client > ${REDIRECT_URI}\n`);
console.log('STEP 2 — Open this URL in your browser:\n');
console.log(authUrl);
console.log('\nWaiting for Google to redirect back to localhost…\n');

const server = http.createServer(async (req, res) => {
  const parsedUrl = url.parse(req.url, true);
  if (parsedUrl.pathname !== '/callback') {
    res.end('Not found');
    return;
  }

  const code  = parsedUrl.query.code;
  const error = parsedUrl.query.error;

  if (error) {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`<h2>Error: ${error}</h2><p>Check your terminal for details.</p>`);
    console.error('\nOAuth error returned by Google:', error);
    server.close();
    process.exit(1);
  }

  if (!code) {
    res.writeHead(400, { 'Content-Type': 'text/html' });
    res.end('<h2>No code received.</h2>');
    server.close();
    return;
  }

  try {
    const { tokens } = await oauth2Client.getToken(code);
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<h2>✅ Success! You can close this tab.</h2><p>Check your terminal for the refresh token.</p>');

    console.log('\n✅ Success! Add this line to your .env file:\n');
    console.log(`GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}`);
    console.log('\n(Also update GOOGLE_REFRESH_TOKEN in your GitHub Actions secrets.)\n');
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'text/html' });
    res.end(`<h2>Failed to exchange code</h2><pre>${err.message}</pre>`);
    console.error('\nFailed to exchange code for tokens:', err.message);
  }

  server.close();
});

server.listen(PORT, '127.0.0.1', () => {
  // Server is ready; URL already printed above.
});
