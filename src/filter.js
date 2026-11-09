// src/filter.js
// Heuristic title-based, regex word-boundary, and description-years filtering.

'use strict';

const {
  SECURITY_KEYWORDS,
  SENIORITY_EXCLUDE,
  COMPANY_EXCLUDE,
  CHECK_DESCRIPTION_YEARS,
  MAX_YEARS,
} = require('./config');

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const SECURITY_REGEX = new RegExp(
  `\\b(${SECURITY_KEYWORDS.map(escapeRegex).join('|')})\\b`,
  'i'
);

const EXCLUDE_REGEX = new RegExp(
  `\\b(${SENIORITY_EXCLUDE.map(escapeRegex).join('|')})\\b`,
  'i'
);

// Helper to expand company exclude list (e.g. TCS -> Tata Consultancy Services)
function expandCompanyList(list) {
  const expanded = [...(list || [])];
  if (
    expanded.some((c) => c.toLowerCase() === 'tcs') &&
    !expanded.some((c) => c.toLowerCase() === 'tata consultancy services')
  ) {
    expanded.push('Tata Consultancy Services');
  }
  return expanded;
}

const DEFAULT_EXPANDED_COMPANIES = expandCompanyList(COMPANY_EXCLUDE);
const DEFAULT_COMPANY_EXCLUDE_REGEX =
  DEFAULT_EXPANDED_COMPANIES.length > 0
    ? new RegExp(
        `\\b(${DEFAULT_EXPANDED_COMPANIES.map(escapeRegex).join('|')})\\b`,
        'i'
      )
    : null;

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

  // Match patterns like "3+ years", "4-6 years", "10+ yrs", "5 to 8 years", "1 yr", etc.
  const matches = [
    ...description.matchAll(/(\d{1,3})\s*(?:\+|to|-)?\s*(\d{1,2})?\s*(?:\+\s*)?(?:years?|yrs?)\b/gi),
  ];
  if (matches.length === 0) return true;

  for (const m of matches) {
    const minVal = parseInt(m[1], 10);
    // Inspect context window around the match to ignore company legacy/history mentions (e.g. "100+ years of history")
    const windowStart = Math.max(0, m.index - 30);
    const windowEnd = Math.min(description.length, m.index + m[0].length + 40);
    const context = description.slice(windowStart, windowEnd).toLowerCase();

    if (
      context.includes('history') ||
      context.includes('financial experience') ||
      context.includes('legacy') ||
      context.includes('in business') ||
      context.includes('founded') ||
      context.includes('established')
    ) {
      continue;
    }

    // Inspect following and preceding context to ignore degree/education duration
    // e.g. "4-year degree", "4 years degree", "4-year Bachelor's", "3-4 year diploma"
    const afterText = description.slice(m.index + m[0].length, m.index + m[0].length + 35).toLowerCase();
    const beforeText = description.slice(Math.max(0, m.index - 30), m.index).toLowerCase();

    const isDegreeMatch =
      (!/^\s*(?:of\s+)?(?:work\s+)?experience/i.test(afterText) &&
        /^\s*[-/]?\s*(?:degree|bachelor|diploma|college|university|undergraduate|accredited)/i.test(afterText)) ||
      /(?:bachelor'?s?|degree|diploma)\s*\(?\s*$/i.test(beforeText);

    if (isDegreeMatch) {
      continue;
    }

    // If minVal > MAX_YEARS (e.g. 3+ years, 4-6 years, 5+ years), reject job immediately
    if (minVal > MAX_YEARS) {
      return false;
    }
  }

  return true;
}

/**
 * Returns true if companyName does NOT match any excluded company.
 * Case-insensitive word-boundary matching.
 */
function passesCompanyFilter(companyName, excludedCompanies = COMPANY_EXCLUDE) {
  if (!companyName || typeof companyName !== 'string') return true;

  let regex;
  if (excludedCompanies === COMPANY_EXCLUDE) {
    regex = DEFAULT_COMPANY_EXCLUDE_REGEX;
  } else if (excludedCompanies && excludedCompanies.length > 0) {
    const expanded = expandCompanyList(excludedCompanies);
    regex = new RegExp(
      `\\b(${expanded.map(escapeRegex).join('|')})\\b`,
      'i'
    );
  }

  if (!regex) return true;

  const normalized = companyName.replace(/\./g, '').replace(/[-_]/g, ' ').trim();
  return !regex.test(normalized);
}

/**
 * Filters jobs by company exclusion rules.
 * Jobs with company matching COMPANY_EXCLUDE will be excluded.
 */
function filterJobsByCompany(jobs, excludedCompanies = COMPANY_EXCLUDE) {
  if (!Array.isArray(jobs)) return [];
  return jobs.filter((job) => {
    const company = job.companyName || job.company || '';
    return passesCompanyFilter(company, excludedCompanies);
  });
}

/**
 * Filters a raw job array by title and description rules.
 */
function filterJobs(rawJobs) {
  if (!Array.isArray(rawJobs)) return [];
  return rawJobs.filter(
    (job) =>
      job &&
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

module.exports = {
  passesTitleFilter,
  passesDescriptionYearsCheck,
  passesCompanyFilter,
  filterJobsByCompany,
  filterJobs,
  deduplicateJobs,
};
