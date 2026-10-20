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

/**
 * Builds a single job card.
 *
 * Design decisions driven by Gmail's sanitizer constraints:
 *  - <details>/<summary> are stripped by Gmail → JD is always-visible in a styled box.
 *  - data: URIs are stripped by Gmail and blocked by modern browsers → not used.
 *  - mailto: copy links truncate the JD (Android Intent ceiling ~2 000 chars) and are
 *    redundant because the full JD is already rendered inline for direct text selection.
 *  - descriptionText (plain text) is preferred over description (raw HTML) to avoid
 *    rendering escaped tag soup in the email body.
 *
 * @param {object} job
 * @returns {string} HTML string
 */
function buildJobCard(job) {
  const title    = escapeHtml(job.title    || 'Unknown Title');
  const company  = escapeHtml(job.companyName || 'Unknown Company');
  const location = escapeHtml((job._location || '').split(',')[0]);
  const link     = job.link || '#';

  const rawDesc = (job.descriptionText || job.text || job.description || '').trim();

  const htmlDesc = escapeHtml(rawDesc).replace(/\n/g, '<br>');

  const jdSection = rawDesc
    ? `<div style="margin:10px 0;border:1px solid #e2e8f0;border-radius:6px;">
         <div style="background-color:#f8fafc;padding:8px 12px;border-bottom:1px solid #e2e8f0;">
           <span style="font-size:11px;font-weight:700;color:#64748b;
                        text-transform:uppercase;letter-spacing:0.05em;">Job Description</span>
         </div>
         <div style="padding:12px;font-size:13px;color:#334155;line-height:1.7;">
           ${htmlDesc}
         </div>
       </div>`
    : `<p style="font-size:13px;color:#94a3b8;margin:8px 0;font-style:italic;">No description available.</p>`;

  return `
    <div style="background-color:#ffffff;border:1px solid #e2e8f0;border-radius:8px;
                padding:16px;margin-bottom:20px;box-shadow:0 1px 3px rgba(0,0,0,0.04);">
      <div style="margin-bottom:8px;">
        <h4 style="margin:0 0 4px 0;font-size:15px;font-weight:600;color:#0f172a;">${title}</h4>
        <div style="font-size:13px;color:#475569;font-weight:500;">🏢 ${company}</div>
      </div>
      ${jdSection}
      <div style="display:flex;align-items:center;justify-content:space-between;
                  margin-top:12px;flex-wrap:wrap;gap:8px;">
        <span style="display:inline-block;background-color:#eff6ff;color:#1d4ed8;font-size:12px;
                     font-weight:500;padding:3px 10px;border-radius:9999px;">
          📍 ${location}
        </span>
        <a href="${link}" target="_blank"
           style="background-color:#2563eb;color:#ffffff;font-size:12px;font-weight:600;
                  text-decoration:none;padding:6px 14px;border-radius:6px;display:inline-block;">
          View Role &rarr;
        </a>
      </div>
    </div>`;
}

/**
 * Renders job cards with a location sub-header whenever the city changes.
 * Assumes jobs are pre-sorted by _location for best grouping.
 * @param {object[]} jobs
 * @returns {string} HTML string
 */
function buildJobCards(jobs) {
  let lastLocation = null;
  const parts = [];
  for (const job of jobs) {
    const loc = (job._location || '').trim();
    if (loc && loc !== lastLocation) {
      lastLocation = loc;
      parts.push(`
        <div style="margin:4px 0 14px 0;padding-bottom:6px;border-bottom:2px solid #cbd5e1;">
          <span style="font-size:14px;font-weight:600;color:#1e293b;">${escapeHtml(loc)}</span>
        </div>`);
    }
    parts.push(buildJobCard(job));
  }
  return parts.join('\n');
}

/**
 * Renders the last-token warning banner.
 * Included in ALL batch emails (not just the summary) so a crash mid-loop
 * doesn't hide the critical quota alert.
 * @param {string} tokenLabel
 * @returns {string} HTML string
 */
function buildLastTokenWarning(tokenLabel) {
  return `
    <div style="background-color:#fff1f2;border:1.5px solid #f87171;border-radius:8px;
                padding:14px 18px;margin-bottom:20px;">
      <strong style="color:#b91c1c;font-size:14px;display:block;margin-bottom:4px;">
        ⚠️ Last API Key in Use - Action Required
      </strong>
      <span style="color:#7f1d1d;font-size:13px;">
        This digest was scraped using
        <code style="background:#fee2e2;padding:1px 5px;border-radius:3px;">${escapeHtml(tokenLabel)}</code>,
        your last remaining Apify token with available quota. Please top up one of your Apify
        accounts or add a new token before the next run.
      </span>
    </div>`;
}

/** Wraps header + content in the standard email shell. */
function buildEmailWrapper(headerHtml, contentHtml) {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;
             background-color:#f8fafc;margin:0;padding:20px;color:#0f172a;">
  <div style="max-width:600px;margin:0 auto;background-color:#ffffff;border-radius:12px;
              border:1px solid #e2e8f0;padding:24px;box-shadow:0 4px 6px -1px rgba(0,0,0,0.05);">
    ${headerHtml}
    ${contentHtml}
    <div style="border-top:1px solid #e2e8f0;padding-top:16px;margin-top:24px;
                color:#94a3b8;font-size:12px;line-height:1.5;text-align:center;">
      Automated digest via Apify &amp; Groq LLM screening. Marked Important via Gmail API.
    </div>
  </div>
</body>
</html>`;
}

/**
 * Builds HTML for a non-summary batch email.
 * @param {object[]} jobs
 * @param {number}   batchNum     1-based index of this email
 * @param {number}   totalBatches total number of emails being sent
 * @param {object}   [opts]       { isLastToken, tokenLabel }
 * @returns {string}
 */
function buildBatchEmailHtml(jobs, batchNum, totalBatches, opts = {}) {
  const { isLastToken = false, tokenLabel = '' } = opts;

  const header = `
    ${isLastToken ? buildLastTokenWarning(tokenLabel) : ''}
    <div style="margin-bottom:20px;text-align:center;">
      <h2 style="margin:0 0 6px 0;font-size:22px;color:#0f172a;">⚡ Cybersecurity Job Digest</h2>
      <p style="margin:0;color:#64748b;font-size:13px;">LinkedIn (0-2 yrs) scraped &amp; LLM verified in past 24 hours</p>
      <span style="display:inline-block;margin-top:8px;background-color:#eff6ff;color:#1d4ed8;
                   font-size:12px;font-weight:600;padding:3px 14px;border-radius:9999px;">
        Mail ${batchNum} of ${totalBatches}
      </span>
    </div>`;

  return buildEmailWrapper(header, buildJobCards(jobs));
}

/**
 * Builds HTML for the final (summary) email - stats card + this batch's jobs.
 * @param {object[]} jobs
 * @param {number}   batchNum
 * @param {number}   totalBatches
 * @param {object}   [stats]  { totalRaw, totalTitle, totalFinal, isLastToken, tokenLabel }
 * @returns {string}
 */
function buildSummaryEmailHtml(jobs, batchNum, totalBatches, stats = {}) {
  const { totalRaw = 0, totalTitle = 0, totalFinal = 0, isLastToken = false, tokenLabel = '' } = stats;

  const header = `
    ${isLastToken ? buildLastTokenWarning(tokenLabel) : ''}
    <div style="margin-bottom:20px;text-align:center;">
      <h2 style="margin:0 0 6px 0;font-size:22px;color:#0f172a;">⚡ Cybersecurity Job Digest - Summary</h2>
      <p style="margin:0;color:#64748b;font-size:13px;">LinkedIn (0-2 yrs) scraped &amp; LLM verified in past 24 hours</p>
      <span style="display:inline-block;margin-top:8px;background-color:#16a34a;color:#ffffff;
                   font-size:12px;font-weight:600;padding:3px 14px;border-radius:9999px;">
        Mail ${batchNum} of ${totalBatches} · Summary
      </span>
    </div>

    <!-- Stats card -->
    <div style="background-color:#f1f5f9;border:1px solid #e2e8f0;border-radius:8px;
                padding:12px;margin-bottom:24px;">
      <table width="100%" border="0" cellspacing="0" cellpadding="0" style="text-align:center;">
        <tr>
          <td width="33%">
            <span style="font-size:18px;font-weight:700;color:#334155;display:block;">${totalRaw}</span>
            <span style="font-size:11px;color:#64748b;text-transform:uppercase;font-weight:600;">Scraped</span>
          </td>
          <td width="33%" style="border-left:1px solid #cbd5e1;border-right:1px solid #cbd5e1;">
            <span style="font-size:18px;font-weight:700;color:#2563eb;display:block;">${totalTitle}</span>
            <span style="font-size:11px;color:#64748b;text-transform:uppercase;font-weight:600;">Title Match</span>
          </td>
          <td width="33%">
            <span style="font-size:18px;font-weight:700;color:#16a34a;display:block;">${totalFinal}</span>
            <span style="font-size:11px;color:#64748b;text-transform:uppercase;font-weight:600;">LLM Approved</span>
          </td>
        </tr>
      </table>
    </div>`;

  return buildEmailWrapper(header, buildJobCards(jobs));
}

/**
 * Sends an email via Gmail API and marks it Important.
 *
 * Threading is achieved via the Gmail API's native `threadId` field in requestBody -
 * synthetic MIME In-Reply-To / References headers alone are ignored by Gmail unless
 * threadId is also provided. Pass the threadId returned by the first batch send to all
 * subsequent sends to group them into a single inbox thread.
 *
 * @param {string} htmlBody
 * @param {string} subject
 * @param {object} [opts]
 * @param {string} [opts.threadId]  Gmail thread ID to attach this message to (batches 2+)
 * @returns {Promise<{messageId: string, threadId: string}>}
 */
async function sendEmailViaGmail(htmlBody, subject, opts = {}) {
  const oauth2Client = new google.auth.OAuth2(
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET
  );
  oauth2Client.setCredentials({ refresh_token: GOOGLE_REFRESH_TOKEN });

  const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

  const headerLines = [
    `To: ${TO_EMAIL}`,
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset=utf-8',
  ];

  const rawMessage = [...headerLines, '', htmlBody].join('\n');

  const encodedMessage = Buffer.from(rawMessage)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  // Include threadId when provided so Gmail attaches this message to an existing thread
  const requestBody = { raw: encodedMessage };
  if (opts.threadId) requestBody.threadId = opts.threadId;

  const sendResp = await gmail.users.messages.send({
    userId: 'me',
    requestBody,
  });

  const messageId = sendResp.data.id;
  const threadId  = sendResp.data.threadId;

  await gmail.users.messages.modify({
    userId: 'me',
    id: messageId,
    requestBody: { addLabelIds: ['IMPORTANT'] },
  });

  return { messageId, threadId };
}

module.exports = {
  escapeHtml,
  buildJobCard,
  buildJobCards,
  buildBatchEmailHtml,
  buildSummaryEmailHtml,
  sendEmailViaGmail,
};
