// src/config.js
// Single source of truth for environment variables and all tunable constants.
// Every other module imports from here; nothing reads process.env directly
// except this file.

'use strict';

require('dotenv').config();

// ---------- ENV VARS ----------

const APIFY_TOKEN  = process.env.APIFY_TOKEN;
const TO_EMAIL     = process.env.TO_EMAIL;
const GROQ_API_KEY = process.env.GROQ_API_KEY;

const GOOGLE_CLIENT_ID     = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const GOOGLE_REFRESH_TOKEN = process.env.GOOGLE_REFRESH_TOKEN;

// ---------- SEARCH TARGETS ----------

const SEARCHES = [
  { location: 'Bengaluru, Karnataka, India', keywords: 'cybersecurity' },
  { location: 'Pune, Maharashtra, India',    keywords: 'cybersecurity' },
];

// ---------- TITLE FILTER ----------

// Title must match at least one of these. Entries that were pure substrings
// of another entry (e.g. 'cloud security', 'aws security', 'application
// security' — all caught by 'security' alone) have been removed to reduce
// maintenance cost with zero extra coverage.
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

// Title must NOT contain any of these.
const SENIORITY_EXCLUDE = [
  'senior', 'sr.', 'sr ', 'staff', 'lead', 'principal', 'director',
  'head of', 'manager', 'architect', 'vp ', 'chief', 'II ', 'III',
  'compliance', 'governance', 'risk', 'audit', 'ciso', 'Archt',
];

// ---------- DESCRIPTION YEARS FILTER (experimental) ----------

// If enabled, jobs whose descriptions contain an explicit experience
// requirement above MAX_YEARS are excluded. Off by default because the regex
// can misfire on unrelated "X years" phrasing.
const CHECK_DESCRIPTION_YEARS = false;
const MAX_YEARS = 3;

// ---------- LLM CONFIG ----------

// Models tried in order. All served via Groq's OpenAI-compatible endpoint.
// On any error the next model is tried automatically.
const GROQ_MODELS = [
  'openai/gpt-oss-120b',
  'qwen/qwen3.8-27b',
  'groq/compound',
  'openai/gpt-oss-20b',
];

const GROQ_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';

const JD_SYSTEM_PROMPT = `You are an assistant that analyses job descriptions to determine the required years of experience.

Rules:
- Reply with ONLY the single digit 1 or 0. No other text, no punctuation, no explanation.
- Reply 1 if the JD mentions less than 2 years of experience OR mentions no specific experience requirement at all.
- Reply 0 if the JD mentions a requirement of 2 or more years of experience.
- When in doubt (ambiguous phrasing), reply 1.`;

// ---------- EXPORTS ----------

module.exports = {
  // env
  APIFY_TOKEN,
  TO_EMAIL,
  GROQ_API_KEY,
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  GOOGLE_REFRESH_TOKEN,
  // search
  SEARCHES,
  // title filter
  SECURITY_KEYWORDS,
  SENIORITY_EXCLUDE,
  // description filter
  CHECK_DESCRIPTION_YEARS,
  MAX_YEARS,
  // llm
  GROQ_MODELS,
  GROQ_ENDPOINT,
  JD_SYSTEM_PROMPT,
};
