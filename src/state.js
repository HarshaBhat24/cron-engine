// src/state.js
// Lightweight JSON-based state persistence for cross-run job deduplication.
// Retains seen job IDs/links with a 7-day TTL to avoid re-screening and re-emailing identical jobs.

'use strict';

const fs = require('fs');
const path = require('path');

const STATE_FILE_PATH = process.env.STATE_FILE_PATH || path.resolve(process.cwd(), '.state.json');
const SEEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function getJobKey(job) {
  if (!job) return '';
  return (
    job.link ||
    job.id ||
    `${(job.title || '').toLowerCase().trim()}|${(job.companyName || job.company || '').toLowerCase().trim()}`
  );
}

function loadSeenJobs(filePath = STATE_FILE_PATH) {
  try {
    if (!fs.existsSync(filePath)) return new Map();
    const raw = fs.readFileSync(filePath, 'utf8');
    const data = JSON.parse(raw);
    const now = Date.now();
    const seenMap = new Map();

    const entries = data.jobs || data;
    if (entries && typeof entries === 'object' && !Array.isArray(entries)) {
      for (const [key, timestamp] of Object.entries(entries)) {
        if (typeof timestamp === 'number' && now - timestamp < SEEN_TTL_MS) {
          seenMap.set(key, timestamp);
        }
      }
    }
    return seenMap;
  } catch (err) {
    console.warn(`[State] Warning: could not load state from ${filePath}: ${err.message}`);
    return new Map();
  }
}

function saveSeenJobs(seenMap, filePath = STATE_FILE_PATH) {
  try {
    const now = Date.now();
    const cleanObj = {};
    if (seenMap instanceof Map) {
      for (const [key, timestamp] of seenMap.entries()) {
        if (typeof timestamp === 'number' && now - timestamp < SEEN_TTL_MS) {
          cleanObj[key] = timestamp;
        }
      }
    }
    fs.writeFileSync(
      filePath,
      JSON.stringify({ jobs: cleanObj, updatedAt: new Date().toISOString() }, null, 2),
      'utf8'
    );
  } catch (err) {
    console.warn(`[State] Warning: could not save state to ${filePath}: ${err.message}`);
  }
}

function filterNewJobs(jobs, seenMap) {
  if (!Array.isArray(jobs)) return [];
  if (!seenMap || !(seenMap instanceof Map)) return jobs;
  return jobs.filter((job) => {
    const key = getJobKey(job);
    return !key || !seenMap.has(key);
  });
}

function markJobsSeen(jobs, seenMap) {
  if (!Array.isArray(jobs) || !seenMap || !(seenMap instanceof Map)) return;
  const now = Date.now();
  for (const job of jobs) {
    const key = getJobKey(job);
    if (key) {
      seenMap.set(key, now);
    }
  }
}

module.exports = {
  STATE_FILE_PATH,
  SEEN_TTL_MS,
  getJobKey,
  loadSeenJobs,
  saveSeenJobs,
  filterNewJobs,
  markJobsSeen,
};
