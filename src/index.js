// src/index.js
// Entry point - orchestrates fetch → title filter → deduplication → company filter → LLM batch filter → email.

'use strict';

const { APIFY_TOKENS, GOOGLE_REFRESH_TOKEN, GROQ_API_KEY, SEARCHES, LLM_BATCH_SIZE } = require('./config');
const { runApifySearch }   = require('./apify');
const { filterJobs, deduplicateJobs, passesCompanyFilter } = require('./filter');
const { checkJDBatchWithLLM, sleep } = require('./llm');
const { buildEmailHtml, sendEmailViaGmail } = require('./email');

async function main() {
  console.log('=== STARTING LINKEDIN JOB DIGEST ===');

  if (!APIFY_TOKENS || APIFY_TOKENS.length === 0) {
    throw new Error('Missing APIFY_TOKEN in .env (at least one token is required)');
  }
  console.log(`[Config] ${APIFY_TOKENS.length} Apify token(s) configured – will use fallback chain if quota runs out.`);
  if (!GOOGLE_REFRESH_TOKEN) {
    throw new Error('Missing GOOGLE_REFRESH_TOKEN - run: npm run auth');
  }
  if (!GROQ_API_KEY) {
    console.warn(
      '[WARN] GROQ_API_KEY not set - LLM experience check will be skipped (all title-filtered jobs kept).'
    );
  }

  const rawJobsByLocation = [];
  const allTitleFiltered = [];
  let totalRawCount = 0;

  // Step 1 & 2: Scrape and apply synchronous Title Filter per location
  let usingLastToken = false;
  let activeTokenLabel = '';
  for (const search of SEARCHES) {
    console.log(`\n--- Fetching Location: ${search.location} ---`);
    const { jobs: rawJobs, isLastToken, tokenLabel } = await runApifySearch(search);
    // Fix #3: only capture the label when it's actually the last token —
    // a later search using an earlier token must not overwrite it.
    if (isLastToken) {
      usingLastToken = true;
      activeTokenLabel = tokenLabel;
    }
    totalRawCount += rawJobs.length;

    const titleFiltered = filterJobs(rawJobs);
    console.log(`  [Title Filter] ${rawJobs.length} raw jobs -> ${titleFiltered.length} matched title & exclude criteria`);

    // Attach location tag to job items
    titleFiltered.forEach((job) => {
      if (!job._location) job._location = search.location;
    });

    rawJobsByLocation.push({ location: search.location, titleJobs: titleFiltered });
    allTitleFiltered.push(...titleFiltered);
  }

  // Step 3: Deduplicate candidate listings across locations
  const uniqueTitleJobs = deduplicateJobs(allTitleFiltered);
  const totalTitleCount = uniqueTitleJobs.length;
  console.log(`\n[Deduplication] Combined ${allTitleFiltered.length} candidate listings into ${uniqueTitleJobs.length} unique jobs.`);

  if (uniqueTitleJobs.length === 0) {
    console.log('\nNo matching jobs found after title filter - skipping email.');
    return;
  }

  // Step 4: Company Filter (after title filter, before LLM filter)
  const candidateJobs = [];
  for (const job of uniqueTitleJobs) {
    const company = job.companyName || job.company || '';
    if (passesCompanyFilter(company)) {
      candidateJobs.push(job);
    } else {
      console.log(`  [Company Filter] Excluded "${job.title}" @ "${company || 'Unknown'}"`);
    }
  }
  const totalCompanyCount = candidateJobs.length;
  console.log(`\n[Company Filter] ${uniqueTitleJobs.length} unique jobs -> ${totalCompanyCount} passed company criteria (excluded ${uniqueTitleJobs.length - totalCompanyCount}).`);

  if (candidateJobs.length === 0) {
    console.log('\nNo matching jobs found after company filter - skipping email.');
    return;
  }

  // Step 5: LLM Batch Screening on candidate jobs
  let uniqueApprovedJobs = [];
  if (!GROQ_API_KEY) {
    uniqueApprovedJobs = candidateJobs;
  } else {
    console.log(`\n--- LLM Screening (${candidateJobs.length} candidate jobs, Batch size: ${LLM_BATCH_SIZE}) ---`);

    for (let i = 0; i < candidateJobs.length; i += LLM_BATCH_SIZE) {
      if (i > 0) await sleep(1000);
      const batch = candidateJobs.slice(i, i + LLM_BATCH_SIZE);
      const verdicts = await checkJDBatchWithLLM(batch);

      batch.forEach((job, idx) => {
        if (verdicts[idx]) uniqueApprovedJobs.push(job);
      });
    }
    console.log(`[LLM Summary] ${candidateJobs.length} candidates -> ${uniqueApprovedJobs.length} passed LLM experience requirements.`);
  }

  const totalFinalCount = uniqueApprovedJobs.length;
  if (totalFinalCount === 0) {
    console.log('\nNo matching jobs today after LLM screening - skipping email.');
    return;
  }

  // Group approved jobs back into resultsByLocation for clean email sections
  const resultsByLocation = SEARCHES.map((search) => {
    const locJobs = uniqueApprovedJobs.filter((job) => job._location === search.location);
    return { location: search.location, jobs: locJobs };
  });

  // Step 6: Send HTML Digest Email
  const html = buildEmailHtml(resultsByLocation, {
    totalRaw: totalRawCount,
    totalTitle: totalTitleCount,
    totalFinal: totalFinalCount,
    isLastToken: usingLastToken,
    tokenLabel: activeTokenLabel,
  });
  const dateStr = new Date().toISOString().slice(0, 10);
  const subject = `Cybersecurity Jobs (0-2 yrs) - Bengaluru & Pune - ${dateStr}`;

  const messageId = await sendEmailViaGmail(html, subject);
  console.log(`\nSent and marked Important. Message ID: ${messageId}`);
}

main().catch((err) => {
  console.error('FAILED:', err.message);
  process.exit(1);
});
