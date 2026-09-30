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
  // Normalize title by converting underscores and hyphens to spaces so boundary \b works on terms like IN_Manager
  const normalizedTitle = (title || '').replace(/[-_]/g, ' ').trim();
  const hasSecurityTerm = SECURITY_REGEX.test(normalizedTitle);
  const hasExcludedTerm = EXCLUDE_REGEX.test(normalizedTitle);
  return hasSecurityTerm && !hasExcludedTerm;
}

/**
 * Checks description years criteria for maximum allowed experience (0-2 years).
 */
function passesDescriptionYearsCheck(description) {
  if (!CHECK_DESCRIPTION_YEARS) return true;
  if (!description) return true;

  // Match patterns like "3+ years", "4-6 years", "10+ yrs", "5 to 8 years", etc.
  const matches = [
    ...description.matchAll(/(\d{1,2})\s*(?:\+|to|-)?\s*(\d{1,2})?\s*(?:\+\s*)?years?/gi),
  ];
  if (matches.length === 0) return true;

  for (const m of matches) {
    const minVal = parseInt(m[1], 10);
    // Ignore historical company age mentions like "100+ years of history"
    const fullMatch = m[0].toLowerCase();
    if (fullMatch.includes('history') || fullMatch.includes('financial experience')) continue;

    // If minVal > MAX_YEARS (e.g. 3+ years, 4-6 years, 5+ years), reject job immediately
    if (minVal > MAX_YEARS) {
      return false;
    }
  }

  return true;
}

/**
 * Filters a raw job array by title and description rules.
 */
function filterJobs(rawJobs) {
  return rawJobs.filter(
    (job) =>
      passesTitleFilter(job.title) &&
      passesDescriptionYearsCheck(job.description || job.descriptionText || job.text)
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
