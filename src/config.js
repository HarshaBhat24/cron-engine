// src/config.js
// Single source of truth for environment variables and all tunable constants.

'use strict';

require('dotenv').config();

// ---------- ENV VARS ----------

// Dynamically discovers all APIFY_TOKEN / APIFY_TOKEN_N keys from the environment.
// Stored as { key, value } pairs so the original env var name is always preserved -
// even when tokens are non-contiguous (e.g. only APIFY_TOKEN + APIFY_TOKEN_5 exist).
const APIFY_TOKENS = [
  { key: 'APIFY_TOKEN', value: process.env.APIFY_TOKEN },  // slot 1 (no suffix)
  ...Object.keys(process.env)                               // slots 2-N, sorted numerically
    .filter(k => /^APIFY_TOKEN_\d+$/.test(k))
    .sort((a, b) => {
      const n = (k) => parseInt(k.replace('APIFY_TOKEN_', ''), 10);
      return n(a) - n(b);
    })
    .map(k => ({ key: k, value: process.env[k] })),
].filter(({ value }) => Boolean(value));
const TO_EMAIL     = process.env.TO_EMAIL;
const GROQ_API_KEY = process.env.GROQ_API_KEY;

const GOOGLE_CLIENT_ID     = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const GOOGLE_REFRESH_TOKEN = process.env.GOOGLE_REFRESH_TOKEN;

// ---------- SEARCH TARGETS ----------

const DEFAULT_SEARCH_LOCATIONS = [
  'Bengaluru, Karnataka, India',
  'Pune, Maharashtra, India',
];

const SEARCH_LOCATIONS = process.env.SEARCH_LOCATIONS
  ? process.env.SEARCH_LOCATIONS.split(/[;\n]/).map((s) => s.trim()).filter(Boolean)
  : DEFAULT_SEARCH_LOCATIONS;

const SEARCH_KEYWORDS = (process.env.SEARCH_KEYWORDS || '').trim() || 'cybersecurity';

const parsedLocations = SEARCH_LOCATIONS.length > 0 ? SEARCH_LOCATIONS : DEFAULT_SEARCH_LOCATIONS;

const SEARCHES = parsedLocations.map((location) => ({
  location,
  keywords: SEARCH_KEYWORDS,
}));

// ---------- TITLE FILTER ----------

const SECURITY_KEYWORDS = [
  'cybersecurity', 'security', 'cyber', 'soc', 'iam', 'siem', 'dlp', 'pentest', 'penetration',
  'vulnerability', 'malware', 'infosec', 'sailpoint', 'cyberark', 'saviynt',
  'devsecops', 'defender', 'cnapp', 'cspm', 'beyondtrust', 'grc',
  'red team', 'blue team', 'purple team', 'incident response', 'exploit',
  'offensive', 'ethical hacker', 'bug bounty', 'reverse engineer',
  'binary analysis', 'adversary emulation', 'cwpp', 'dspm', 'sase', 'ztna',
  'wiz', 'prisma cloud', 'lacework', 'appsec', 'prodsec', 'sast', 'dast',
  'iast', 'snyk', 'veracode', 'checkmarx',
];

const SENIORITY_EXCLUDE = [
  'senior', 'sr', 'staff', 'lead', 'principal', 'director',
  'head of', 'manager', 'architect', 'vp', 'vice president', 'avp', 'chief',
  'ii', 'iii', 'iv', 'l2', 'l3', 'l4', 'ciso', 'archt',
  'advisor', 'officer', 'specialist', 'expert', 'escalation',
  'compliance', 'governance', 'risk', 'audit', 'auditor'
];

// ---------- COMPANY FILTER ----------

const DEFAULT_COMPANY_EXCLUDE = [
  'Infosys', 'Wipro', 'Capgemini', 'TCS', 'Tata Consultancy Services', 'IBM', 'Flexiple',
];

/**
 * Parses and sanitizes company exclusion strings from environment variables.
 * Handles comma/semicolon/newline separation, single/double quotes, and JSON array notation.
 */
function parseCompanyExclude(raw, defaultList = DEFAULT_COMPANY_EXCLUDE) {
  if (!raw || typeof raw !== 'string') return defaultList;

  let cleaned = raw.trim().replace(/^['"]+|['"]+$/g, '').trim();

  if (cleaned.startsWith('[') && cleaned.endsWith(']')) {
    try {
      const parsed = JSON.parse(cleaned);
      if (Array.isArray(parsed)) {
        const list = parsed
          .map((s) => String(s || '').trim().replace(/^['"`]+|['"`]+$/g, '').trim())
          .filter(Boolean);
        if (list.length > 0) return list;
      }
    } catch {
      cleaned = cleaned.slice(1, -1);
    }
  }

  const list = cleaned
    .split(/[,;\n]/)
    .map((s) => s.trim().replace(/^['"`]+|['"`]+$/g, '').trim())
    .filter(Boolean);

  return list.length > 0 ? list : defaultList;
}

const COMPANY_EXCLUDE = parseCompanyExclude(process.env.COMPANY_EXCLUDE, DEFAULT_COMPANY_EXCLUDE);

// ---------- DESCRIPTION YEARS FILTER ----------

const CHECK_DESCRIPTION_YEARS = true;
const MAX_YEARS = 2;

// ---------- LLM CONFIG ----------

const GROQ_MODELS = [
  'openai/gpt-oss-120b',
  'qwen/qwen3.8-27b',
  'openai/gpt-oss-20b',
];

const GROQ_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';
const LLM_BATCH_SIZE = 5;

const JD_SYSTEM_PROMPT = `You are a technical job screener evaluating job descriptions for entry-level / early-career positions (0 to 2 years of experience or unspecified/ambiguous experience). Output valid JSON only.`;

// ---------- EMAIL & DELIVERY CONFIG ----------

/**
 * Parses MAIL_BATCH_SIZE.
 * Defaults to 0 (all matching jobs sent in 1 single email per day).
 * Set to a number > 1 (e.g. 3) to enable chunked batch emails.
 */
function parseMailBatchSize(val) {
  if (val === undefined || val === null || val === '') return 0;
  const num = parseInt(val, 10);
  if (isNaN(num) || num <= 1) return 0;
  return num;
}

const MAIL_BATCH_SIZE = parseMailBatchSize(process.env.MAIL_BATCH_SIZE);
const SEND_EMPTY_DIGEST = process.env.SEND_EMPTY_DIGEST === 'true';

module.exports = {
  APIFY_TOKENS,
  TO_EMAIL,
  GROQ_API_KEY,
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  GOOGLE_REFRESH_TOKEN,
  DEFAULT_SEARCH_LOCATIONS,
  SEARCH_LOCATIONS: parsedLocations,
  SEARCH_KEYWORDS,
  SEARCHES,
  SECURITY_KEYWORDS,
  SENIORITY_EXCLUDE,
  DEFAULT_COMPANY_EXCLUDE,
  COMPANY_EXCLUDE,
  parseCompanyExclude,
  CHECK_DESCRIPTION_YEARS,
  MAX_YEARS,
  GROQ_MODELS,
  GROQ_ENDPOINT,
  LLM_BATCH_SIZE,
  JD_SYSTEM_PROMPT,
  MAIL_BATCH_SIZE,
  parseMailBatchSize,
  SEND_EMPTY_DIGEST,
};

