// src/filter.js
// Heuristic title-based, regex word-boundary, and description-years filtering.

'use strict';

const {
  SECURITY_KEYWORDS,
  SENIORITY_EXCLUDE,
  CHECK_DESCRIPTION_YEARS,
  MAX_YEARS,
} = require('./config');

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const SECURITY_REGEX = new RegExp(
  SECURITY_KEYWORDS.map(escapeRegex).join('|'),
  'i'
);

const EXCLUDE_REGEX = new RegExp(
  `\\b(${SENIORITY_EXCLUDE.map(escapeRegex).join('|')})\\b`,
  'i'
);

/**
 * Returns true if the job title matches security keywords
 * and does NOT contain any seniority exclusion term at word boundaries.
 */
function passesTitleFilter(title) {
  const t = (title || '').trim();
  const hasSecurityTerm = SECURITY_REGEX.test(t);
  const hasExcludedTerm = EXCLUDE_REGEX.test(t);
  return hasSecurityTerm && !hasExcludedTerm;
}

/**
 * Checks optional description years criteria.
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
 * Filters a raw job array by title and description rules.
 */
function filterJobs(rawJobs) {
  return rawJobs.filter(
    (job) =>
      passesTitleFilter(job.title) &&
      passesDescriptionYearsCheck(job.description || job.descriptionText)
  );
}

/**
 * Deduplicates jobs across search locations based on link or title+company.
 */
function deduplicateJobs(jobs) {
  const seen = new Set();
  return jobs.filter((j) => {
    const key = j.link || j.id || `${(j.title || '').toLowerCase().trim()}|${(j.companyName || '').toLowerCase().trim()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

module.exports = { passesTitleFilter, passesDescriptionYearsCheck, filterJobs, deduplicateJobs };
