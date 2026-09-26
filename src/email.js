// src/email.js
// Builds the HTML digest and sends it via Gmail API (OAuth2).

'use strict';

const { google } = require('googleapis');
const {
  TO_EMAIL,
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  GOOGLE_REFRESH_TOKEN,
} = require('./config');

function escapeHtml(str) {
  return String(str || '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[c]));
}

function buildEmailHtml(resultsByLocation, stats = {}) {
  const { totalRaw = 0, totalTitle = 0, totalFinal = 0 } = stats;

  const sections = resultsByLocation
    .filter(({ jobs }) => jobs.length > 0)
    .map(({ location, jobs }) => {
      const cards = jobs
        .map(
          (j) => `
            <div style="background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin-bottom: 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.04);">
              <div style="margin-bottom: 6px;">
                <h4 style="margin: 0 0 4px 0; font-size: 15px; font-weight: 600; color: #0f172a;">${escapeHtml(j.title)}</h4>
                <div style="font-size: 13px; color: #475569; font-weight: 500;">
                  🏢 ${escapeHtml(j.companyName || 'Unknown Company')}
                </div>
              </div>
              <div style="display: flex; align-items: center; justify-content: space-between; margin-top: 10px;">
                <span style="display: inline-block; background-color: #eff6ff; color: #1d4ed8; font-size: 12px; font-weight: 500; padding: 3px 10px; border-radius: 9999px;">
                  📍 ${escapeHtml(location.split(',')[0])}
                </span>
                <a href="${j.link}" target="_blank" style="background-color: #2563eb; color: #ffffff; font-size: 12px; font-weight: 600; text-decoration: none; padding: 6px 14px; border-radius: 6px; display: inline-block;">
                  View Role &rarr;
                </a>
              </div>
            </div>`
        )
        .join('\n');

      return `
        <div style="margin-bottom: 24px;">
          <h3 style="color: #1e293b; border-bottom: 2px solid #cbd5e1; padding-bottom: 6px; margin-bottom: 14px; font-size: 17px;">
            ${escapeHtml(location)} <span style="font-weight: normal; color: #64748b; font-size: 13px;">(${jobs.length} matching)</span>
          </h3>
          ${cards}
        </div>`;
    })
    .join('\n');

  return `
  <!DOCTYPE html>
  <html>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
  </head>
  <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; margin: 0; padding: 20px; color: #0f172a;">
    <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; border: 1px solid #e2e8f0; padding: 24px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05);">
      
      <!-- Header -->
      <div style="margin-bottom: 20px; text-align: center;">
        <h2 style="margin: 0 0 6px 0; font-size: 22px; color: #0f172a;">⚡ Cybersecurity Job Digest</h2>
        <p style="margin: 0; color: #64748b; font-size: 13px;">LinkedIn (0-3 yrs) scraped & LLM verified in past 24 hours</p>
      </div>

      <!-- Metrics Card -->
      <div style="background-color: #f1f5f9; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px; margin-bottom: 24px;">
        <table width="100%" border="0" cellspacing="0" cellpadding="0" style="text-align: center;">
          <tr>
            <td width="33%">
              <span style="font-size: 18px; font-weight: 700; color: #334155; display: block;">${totalRaw}</span>
              <span style="font-size: 11px; color: #64748b; text-transform: uppercase; font-weight: 600;">Scraped</span>
            </td>
            <td width="33%" style="border-left: 1px solid #cbd5e1; border-right: 1px solid #cbd5e1;">
              <span style="font-size: 18px; font-weight: 700; color: #2563eb; display: block;">${totalTitle}</span>
              <span style="font-size: 11px; color: #64748b; text-transform: uppercase; font-weight: 600;">Title Match</span>
            </td>
            <td width="33%">
              <span style="font-size: 18px; font-weight: 700; color: #16a34a; display: block;">${totalFinal}</span>
              <span style="font-size: 11px; color: #64748b; text-transform: uppercase; font-weight: 600;">LLM Approved</span>
            </td>
          </tr>
        </table>
      </div>

      <!-- Content Sections -->
      ${sections}

      <!-- Footer -->
      <div style="border-top: 1px solid #e2e8f0; padding-top: 16px; margin-top: 24px; color: #94a3b8; font-size: 12px; line-height: 1.5; text-align: center;">
        Automated digest via Apify & Groq LLM screening. Marked Important via Gmail API.
      </div>
    </div>
  </body>
  </html>
  `;
}

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

  await gmail.users.messages.modify({
    userId: 'me',
    id: messageId,
    requestBody: { addLabelIds: ['IMPORTANT'] },
  });

  return messageId;
}

module.exports = { escapeHtml, buildEmailHtml, sendEmailViaGmail };
