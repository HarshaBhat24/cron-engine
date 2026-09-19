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
// security' - all caught by 'security' alone) have been removed to reduce
// maintenance cost with zero extra coverage.
const SECURITY_KEYWORDS = [
  'security', 'cyber', 'soc', 'iam', 'siem', 'dlp', 'pentest', 'penetration',
  'vulnerability', 'malware', 'infosec', 'binary analysis', 'adversary emulation',
  'devsecops', 'defender', 'appsec', 'prodsec', 'sast', 'dast', 'iast',
  'red team', 'blue team', 'purple team', 'incident response', 'exploit',
  'offensive', 'ethical hacker', 'bug bounty', 'reverse engineer',
];

// Title must NOT contain any of these.
const SENIORITY_EXCLUDE = [
  'senior', 'sr.', 'sr ', 'staff', 'lead', 'principal', 'director',
  'head of', 'manager', 'architect', 'vp ', 'chief', 'II ', 'III',
  'compliance', 'governance', 'risk', 'audit', 'ciso', 'Archt', 'GRC'
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

const JD_SYSTEM_PROMPT = `You are a job-description analyser. Your only job is to determine whether a JD requires 2 or more years of experience.

Output format - respond with ONLY valid JSON, exactly one of:
  {"verdict": 1}   ← experience < 2 years, OR no experience requirement mentioned
  {"verdict": 0}   ← experience requirement is 2 or more years

Rules:
- Output NOTHING except the JSON object. No explanation, no markdown, no extra keys.
- When in doubt or phrasing is ambiguous, use {"verdict": 1}.

Examples:
User: "We are looking for a fresher or 0–1 year experienced candidate."
Assistant: {"verdict": 1}

User: "Minimum 3 years of hands-on experience in cybersecurity required."
Assistant: {"verdict": 0}

User: "5+ years of experience is mandatory for this role."
Assistant: {"verdict": 0}

User: "No prior experience needed - we will provide full training."
Assistant: {"verdict": 1}

User: "2+ years of experience in information security or a related field."
Assistant: {"verdict": 0}`;

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
