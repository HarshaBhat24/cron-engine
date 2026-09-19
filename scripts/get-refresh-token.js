// scripts/get-refresh-token.js
// Run this ONCE, locally, to obtain a Gmail API refresh token for the cron script.
//
// Usage:
//   npm run auth
//   - or -
//   node scripts/get-refresh-token.js
//
// Opens an OAuth2 consent URL; paste the returned code back into the terminal.
// Copy the printed GOOGLE_REFRESH_TOKEN=... line into your .env file.

'use strict';

require('dotenv').config();
const { google }   = require('googleapis');
const readline     = require('readline');

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  'urn:ietf:wg:oauth:2.0:oob' // out-of-band redirect - no local server needed
);

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.modify',
];

const authUrl = oauth2Client.generateAuthUrl({
  access_type: 'offline',
  prompt: 'consent', // forces a refresh_token to be included in the response
  scope: SCOPES,
});

console.log('1. Open this URL in a browser:\n');
console.log(authUrl);
console.log('\n2. Approve access, copy the code shown, and paste it below.\n');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

rl.question('Paste code here: ', async (code) => {
  rl.close();
  try {
    const { tokens } = await oauth2Client.getToken(code.trim());
    console.log('\nSuccess. Add this line to your .env file:\n');
    console.log(`GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}`);
  } catch (err) {
    console.error('Failed to exchange code:', err.message);
    process.exit(1);
  }
});
