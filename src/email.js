// src/email.js
// Builds the HTML digest and sends it via Gmail API (OAuth2).
// Sent messages are tagged with Gmail's IMPORTANT label.

'use strict';

const { google } = require('googleapis');
const {
  TO_EMAIL,
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  GOOGLE_REFRESH_TOKEN,
} = require('./config');

// ---------- HELPERS ----------

/**
 * Escapes characters that have special meaning in HTML.
 *
 * @param {string} str
 * @returns {string}
 */
function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[c]));
}

// ---------- HTML BUILD ----------

/**
 * Builds the full HTML body for the digest email.
 *
 * @param {{ location: string, jobs: object[] }[]} resultsByLocation
 * @returns {string}
 */
function buildEmailHtml(resultsByLocation) {
  const sections = resultsByLocation
    .map(({ location, jobs }) => {
      const items = jobs
        .map(
          (j) =>
            `<li><b>${escapeHtml(j.title)}</b> - ${escapeHtml(j.companyName || 'Unknown')} - <a href="${j.link}">Link</a></li>`
        )
        .join('\n');
      return `<h3>${escapeHtml(location)} (${jobs.length})</h3><ol>${items}</ol>`;
    })
    .join('\n');

  const total = resultsByLocation.reduce((sum, r) => sum + r.jobs.length, 0);

  return `
    <h2>Cybersecurity Roles - Last 24 Hours (0-3 yrs, senior excluded)</h2>
    <p>Total: ${total}</p>
    ${sections}
    <p style="color:#666;font-size:12px;">
      Filtered by title keyword match + LLM JD experience check. Title filter
      is a heuristic; LLM check reads the description text via Groq.
    </p>
  `;
}

// ---------- GMAIL SEND ----------

/**
 * Sends an HTML email via the Gmail API and marks it as Important.
 *
 * @param {string} htmlBody
 * @param {string} subject
 * @returns {Promise<string>} Gmail message ID
 */
async function sendEmailViaGmail(htmlBody, subject) {
  const oauth2Client = new google.auth.OAuth2(
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET
  );
  oauth2Client.setCredentials({ refresh_token: GOOGLE_REFRESH_TOKEN });

  const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

  const rawMessage = [
    `To: ${TO_EMAIL}`,
    `Subject: ${subject}`,
    'Content-Type: text/html; charset=utf-8',
    '',
    htmlBody,
  ].join('\n');

  const encodedMessage = Buffer.from(rawMessage)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  const sendResp = await gmail.users.messages.send({
    userId: 'me',
    requestBody: { raw: encodedMessage },
  });

  const messageId = sendResp.data.id;

  // Mark as Important - only possible via the Gmail API, not plain SMTP.
  await gmail.users.messages.modify({
    userId: 'me',
    id: messageId,
    requestBody: { addLabelIds: ['IMPORTANT'] },
  });

  return messageId;
}

module.exports = { escapeHtml, buildEmailHtml, sendEmailViaGmail };
