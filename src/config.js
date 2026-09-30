// src/config.js
// Single source of truth for environment variables and all tunable constants.

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

const SENIORITY_EXCLUDE = [
  'senior', 'sr', 'staff', 'lead', 'principal', 'director',
  'head of', 'manager', 'architect', 'vp', 'vice president', 'avp', 'chief',
  'ii', 'iii', 'iv', 'l2', 'l3', 'l4', 'ciso', 'archt',
  'advisor', 'officer', 'specialist', 'expert', 'escalation',
  'compliance', 'governance', 'risk', 'audit'
];

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

const JD_SYSTEM_PROMPT = `You are a strict technical job screener evaluating job descriptions for entry-level positions requiring 0 to 2 years of experience. Output valid JSON only.`;

module.exports = {
  APIFY_TOKEN,
  TO_EMAIL,
  GROQ_API_KEY,
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  GOOGLE_REFRESH_TOKEN,
  SEARCHES,
  SECURITY_KEYWORDS,
  SENIORITY_EXCLUDE,
  CHECK_DESCRIPTION_YEARS,
  MAX_YEARS,
  GROQ_MODELS,
  GROQ_ENDPOINT,
  LLM_BATCH_SIZE,
  JD_SYSTEM_PROMPT,
};

