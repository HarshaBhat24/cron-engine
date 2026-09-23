// src/filter.js
// Heuristic title-based and optional description-years-based filtering.
// These filters are synchronous and require no external API calls.

'use strict';

const {
  SECURITY_KEYWORDS,
  SENIORITY_EXCLUDE,
  CHECK_DESCRIPTION_YEARS,
  MAX_YEARS,
} = require('./config');

// ---------- REGEX SETUP ----------

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Compiled once at module load for efficiency.
const SECURITY_REGEX = new RegExp(
  SECURITY_KEYWORDS.map(escapeRegex).join('|'),
  'i'
);

// ---------- FILTER FUNCTIONS ----------

/**
 * Returns true if the job title contains a security keyword
 * and does NOT contain a seniority exclusion term.
 *
 * @param {string} title
 * @returns {boolean}
 */
function passesTitleFilter(title) {
  const t = (title || '').toLowerCase();
  const hasSecurityTerm  = SECURITY_REGEX.test(t);
  const hasExcludedTerm  = SENIORITY_EXCLUDE.some((k) => t.includes(k.toLowerCase()));
  return hasSecurityTerm && !hasExcludedTerm;
}

/**
 * If CHECK_DESCRIPTION_YEARS is enabled, returns false when a description
 * explicitly requires more than MAX_YEARS years of experience.
 * Defaults to true (keep) when the flag is off or data is missing.
 *
 * @param {string} description
 * @returns {boolean}
 */
function passesDescriptionYearsCheck(description) {
  if (!CHECK_DESCRIPTION_YEARS) return true;
  if (!description) return true;

  const matches = [
    ...description.matchAll(/(\d{1,2})\s*\+?\s*(?:-|to)?\s*(\d{1,2})?\s*\+?\s*years?/gi),
  ];
  if (matches.length === 0) return true;

  const minYearsFound = Math.min(...matches.map((m) => parseInt(m[1], 10)));
  return minYearsFound <= MAX_YEARS;
}

/**
 * Applies both title and description-years filters to a raw job array.
 *
 * @param {object[]} rawJobs
 * @returns {object[]}
 */
function filterJobs(rawJobs) {
  return rawJobs.filter(
    (job) =>
      passesTitleFilter(job.title) &&
      passesDescriptionYearsCheck(job.description)
  );
}

module.exports = { passesTitleFilter, passesDescriptionYearsCheck, filterJobs };
