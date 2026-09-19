// src/apify.js
// Responsible for fetching raw job listings from the Apify LinkedIn scraper.

'use strict';

const { APIFY_TOKEN } = require('./config');

/**
 * Runs the Apify LinkedIn jobs scraper for a single search configuration
 * and returns the raw array of job objects.
 *
 * @param {{ location: string, keywords: string }} search
 * @returns {Promise<object[]>}
 */
async function runApifySearch({ location, keywords }) {
  const runInput = {
    autoConvertToAiSearch: true,
    datePosted: 'past24Hours',
    keywords,
    limitPerSource: 250,
    location,
    scrapeCompany: false,
  };

  const resp = await fetch(
    `https://api.apify.com/v2/acts/curious_coder~linkedin-jobs-scraper/run-sync-get-dataset-items?token=${APIFY_TOKEN}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(runInput),
    }
  );

  if (!resp.ok) {
    throw new Error(
      `Apify run failed for ${location}: ${resp.status} ${await resp.text()}`
    );
  }

  return resp.json();
}

module.exports = { runApifySearch };
