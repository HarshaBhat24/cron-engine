// job-digest.js
// Daily LinkedIn cybersecurity job digest -> filtered -> emailed via Gmail (marked Important)
// Run manually:  node job-digest.js
// Run via cron:  0 18 * * * cd /path/to/linkedin-digest && node job-digest.js >> digest.log 2>&1

require('dotenv').config();
const { google } = require('googleapis');

// ---------- CONFIG ----------

const APIFY_TOKEN = process.env.APIFY_TOKEN;
const TO_EMAIL = process.env.TO_EMAIL || 'bharsha12121@gmail.com';

const SEARCHES = [
  { location: 'Bengaluru, Karnataka, India', keywords: 'cybersecurity' },
  { location: 'Pune, Maharashtra, India', keywords: 'cybersecurity' },
];

// Title must match at least one of these. Entries that were pure substrings
// of another entry (e.g. 'cloud security', 'aws security', 'application
// security' - all already caught by 'security' alone) have been removed;
// they added maintenance cost with zero extra coverage.
const SECURITY_KEYWORDS = [
  'security', 'cyber', 'soc', 'iam', 'siem', 'dlp', 'pentest', 'penetration',
  'vulnerability', 'malware', 'infosec', 'sailpoint', 'cyberark', 'saviynt',
  'devsecops', 'defender', 'cnapp', 'cspm', 'beyondtrust', 'grc',
  'red team', 'blue team', 'purple team', 'incident response', 'exploit',
  'offensive', 'ethical hacker', 'bug bounty', 'reverse engineer',
  'binary analysis', 'adversary emulation', 'cwpp', 'dspm', 'sase', 'ztna',
  'wiz', 'prisma cloud', 'lacework', 'appsec', 'prodsec', 'sast', 'dast',
  'iast', 'snyk', 'veracode', 'checkmarx',
];

// Compiled once at module load instead of re-scanning the array with
// .some()/.includes() on every single title.
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
const SECURITY_REGEX = new RegExp(SECURITY_KEYWORDS.map(escapeRegex).join('|'), 'i');

// Title must NOT contain any of these. This is your literal rule:
// exclude "senior". The extra terms below are commented out by default -
// uncomment them once you've confirmed the narrower list isn't missing
// jobs you actually want (they catch Staff/Lead/Principal/Director/Manager/
// Architect titles, which are equally not 0-3yr roles but won't say "senior").
const SENIORITY_EXCLUDE = [
  'senior', 'sr.', 'sr ','staff', 'lead', 'principal', 'director', 'head of', 'manager', 'architect', 'vp ', 'chief', 'II ', 'III', 'compliance', 'governance', 'risk', 'audit', 'ciso', 'Archt'
];

// EXPERIMENTAL - off by default. If a job's description text contains an
// explicit years-of-experience requirement above this number, exclude it.
// Turn on only after spot-checking it doesn't wrongly cut jobs where the
// regex misfires (ranges, "X+ years in the industry" unrelated phrasing, etc).
const CHECK_DESCRIPTION_YEARS = false;
const MAX_YEARS = 3;

// ---------- APIFY: FETCH JOBS ----------

async function runApifySearch({ location, keywords }) {
  const runInput = {
    autoConvertToAiSearch: true,
    datePosted: 'past24Hours',
    keywords,
    limitPerSource: 250,
    location,
    scrapeCompany: false,
  };

  const runResp = await fetch(
    `https://api.apify.com/v2/acts/curious_coder~linkedin-jobs-scraper/run-sync-get-dataset-items?token=${APIFY_TOKEN}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(runInput),
    }
  );

  if (!runResp.ok) {
    throw new Error(`Apify run failed for ${location}: ${runResp.status} ${await runResp.text()}`);
  }

  return runResp.json();
}

// ---------- FILTERING ----------

function passesTitleFilter(title) {
  const t = (title || '').toLowerCase();
  const hasSecurityTerm = SECURITY_REGEX.test(t);
  const hasExcludedTerm = SENIORITY_EXCLUDE.some((k) => t.includes(k));
  return hasSecurityTerm && !hasExcludedTerm;
}

function passesDescriptionYearsCheck(description) {
  if (!CHECK_DESCRIPTION_YEARS) return true;
  if (!description) return true; // no description text to check, don't exclude on missing data

  const matches = [...description.matchAll(/(\d{1,2})\s*\+?\s*(?:-|to)?\s*(\d{1,2})?\s*\+?\s*years?/gi)];
  if (matches.length === 0) return true;

  const minYearsFound = Math.min(...matches.map((m) => parseInt(m[1], 10)));
  return minYearsFound <= MAX_YEARS;
}

function filterJobs(rawJobs) {
  return rawJobs.filter(
    (job) => passesTitleFilter(job.title) && passesDescriptionYearsCheck(job.description)
  );
}

// ---------- EMAIL BUILD ----------

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
      Filtered by title keyword match. This is a heuristic,
      not a guaranteed experience-level filter - LinkedIn no longer exposes a
      structured experience filter via public search.
    </p>
  `;
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------- GMAIL SEND (OAuth) ----------

async function sendEmailViaGmail(htmlBody, subject) {
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );
  oauth2Client.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });

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

  // Mark as Important - this only works via the Gmail API, not plain SMTP.
  await gmail.users.messages.modify({
    userId: 'me',
    id: messageId,
    requestBody: { addLabelIds: ['IMPORTANT'] },
  });

  return messageId;
}

// ---------- MAIN ----------

async function main() {
  if (!APIFY_TOKEN) throw new Error('Missing APIFY_TOKEN in .env');
  if (!process.env.GOOGLE_REFRESH_TOKEN) throw new Error('Missing GOOGLE_REFRESH_TOKEN - run get-refresh-token.js once first');

  const resultsByLocation = [];

  for (const search of SEARCHES) {
    console.log(`Fetching: ${search.location}...`);
    const rawJobs = await runApifySearch(search);
    const filtered = filterJobs(rawJobs);
    console.log(`  ${rawJobs.length} raw -> ${filtered.length} after filtering`);
    resultsByLocation.push({ location: search.location, jobs: filtered });
  }

  const totalJobs = resultsByLocation.reduce((sum, r) => sum + r.jobs.length, 0);
  if (totalJobs === 0) {
    console.log('No matching jobs today - skipping email.');
    return;
  }

  const html = buildEmailHtml(resultsByLocation);
  const dateStr = new Date().toISOString().slice(0, 10);
  const subject = `Cybersecurity Jobs (0-3 yrs) - Bengaluru & Pune - ${dateStr}`;

  const messageId = await sendEmailViaGmail(html, subject);
  console.log(`Sent and marked Important. Message ID: ${messageId}`);
}

main().catch((err) => {
  console.error('FAILED:', err.message);
  process.exit(1);
});