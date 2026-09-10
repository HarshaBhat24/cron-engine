// get-refresh-token.js
// Run this ONCE, locally, to get a Gmail API refresh token for the cron script.
// Usage: node get-refresh-token.js
// It will print a URL - open it, log in as bharsha12121@gmail.com, approve,
// then paste the resulting code back into the terminal.

require('dotenv').config();
const { google } = require('googleapis');
const readline = require('readline');

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  'urn:ietf:wg:oauth:2.0:oob' // out-of-band, no redirect server needed
);

const SCOPES = ['https://www.googleapis.com/auth/gmail.send', 'https://www.googleapis.com/auth/gmail.modify'];

const authUrl = oauth2Client.generateAuthUrl({
  access_type: 'offline',
  prompt: 'consent', // forces a refresh_token to be returned
  scope: SCOPES,
});

console.log('1. Open this URL in a browser (log in as bharsha12121@gmail.com):\n');
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
  }
});