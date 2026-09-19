// src/index.js
// Entry point - orchestrates fetch → title filter → LLM JD filter → email.
// Run manually:  node src/index.js
// Run via cron:  0 18 * * * cd /path/to/cron-job-search && node src/index.js >> digest.log 2>&1

'use strict';

const { APIFY_TOKEN, GOOGLE_REFRESH_TOKEN, GROQ_API_KEY, SEARCHES } = require('./config');
const { runApifySearch }   = require('./apify');
const { filterJobs }       = require('./filter');
const { checkJDWithLLM }   = require('./llm');
const { buildEmailHtml, sendEmailViaGmail } = require('./email');

async function main() {
  // ---------- STARTUP CHECKS ----------

  if (!APIFY_TOKEN) {
    throw new Error('Missing APIFY_TOKEN in .env');
  }
  if (!GOOGLE_REFRESH_TOKEN) {
    throw new Error('Missing GOOGLE_REFRESH_TOKEN - run: npm run auth');
  }
  if (!GROQ_API_KEY) {
    console.warn(
      '[WARN] GROQ_API_KEY not set - LLM experience check will be skipped ' +
      '(all title-filtered jobs are kept).'
    );
  }

  // ---------- FETCH → FILTER → LLM ----------

  const resultsByLocation = [];

  for (const search of SEARCHES) {
    console.log(`\nFetching: ${search.location}...`);

    // Step 1 - Apify scrape
    const rawJobs = await runApifySearch(search);

    // Step 2 - synchronous title heuristic filter
    const titleFiltered = filterJobs(rawJobs);
    console.log(`  ${rawJobs.length} raw → ${titleFiltered.length} after title filter`);

    // Step 3 - async LLM JD experience filter (Groq fallback chain)
    // The 1.5 s pause between calls keeps sequential requests comfortably
    // under Groq's tokens-per-minute quota on the free tier.
    const llmFiltered = [];
    for (let i = 0; i < titleFiltered.length; i++) {
      if (i > 0) await new Promise((r) => setTimeout(r, 1500));
      const keep = await checkJDWithLLM(titleFiltered[i].descriptionText);
      if (keep === 1) llmFiltered.push(titleFiltered[i]);
    }
    console.log(`  ${titleFiltered.length} after title filter → ${llmFiltered.length} after LLM JD check`);

    resultsByLocation.push({ location: search.location, jobs: llmFiltered });
  }

  // ---------- EMAIL ----------

  const totalJobs = resultsByLocation.reduce((sum, r) => sum + r.jobs.length, 0);

  if (totalJobs === 0) {
    console.log('\nNo matching jobs today - skipping email.');
    return;
  }

  const html    = buildEmailHtml(resultsByLocation);
  const dateStr = new Date().toISOString().slice(0, 10);
  const subject = `Cybersecurity Jobs (0-3 yrs) - Bengaluru & Pune - ${dateStr}`;

  const messageId = await sendEmailViaGmail(html, subject);
  console.log(`\nSent and marked Important. Message ID: ${messageId}`);
}

main().catch((err) => {
  console.error('FAILED:', err.message);
  process.exit(1);
});
