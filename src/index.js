// src/index.js
// Entry point - orchestrates fetch → title filter → deduplication → company filter → LLM batch filter → email.

'use strict';

const { APIFY_TOKENS, GOOGLE_REFRESH_TOKEN, GROQ_API_KEY, SEARCHES, LLM_BATCH_SIZE } = require('./config');
const { runApifySearch }   = require('./apify');
const { filterJobs, deduplicateJobs, passesCompanyFilter } = require('./filter');
const { checkJDBatchWithLLM, sleep } = require('./llm');
const { buildBatchEmailHtml, buildSummaryEmailHtml, sendEmailViaGmail } = require('./email');

const MAIL_BATCH_SIZE = 3;

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

  // Sort by location so jobs from the same city land in the same batch where possible.
  // This makes location sub-headers in each email coherent.
  uniqueApprovedJobs.sort((a, b) => (a._location || '').localeCompare(b._location || ''));

  // Step 6: Send batched HTML digest emails
  // Chunk approved jobs into groups of MAIL_BATCH_SIZE.
  // The last email always carries the remaining jobs (1–MAIL_BATCH_SIZE) + summary stats card.
  const dateStr      = new Date().toISOString().slice(0, 10);
  const totalBatches = Math.ceil(uniqueApprovedJobs.length / MAIL_BATCH_SIZE);

  console.log(`\n--- Sending ${totalBatches} email(s) (${MAIL_BATCH_SIZE} jobs/mail, last mail = summary) ---`);

  let sentCount    = 0;
  let firstThreadId = null; // Captured from batch 1; passed to batches 2+ for Gmail threading

  for (let i = 0; i < totalBatches; i++) {
    const batchNum    = i + 1;
    const batchJobs   = uniqueApprovedJobs.slice(i * MAIL_BATCH_SIZE, (i + 1) * MAIL_BATCH_SIZE);
    const isLastBatch = batchNum === totalBatches;

    // [N/N] for regular batches; [N/N - Summary] for the last one.
    // Different subjects are fine for threading because we use the Gmail API threadId directly,
    // not subject-based matching.
    const subject = isLastBatch
      ? `Cybersecurity Jobs (0-2 yrs) - Bengaluru & Pune - ${dateStr} [${batchNum}/${totalBatches} - Summary]`
      : `Cybersecurity Jobs (0-2 yrs) - Bengaluru & Pune - ${dateStr} [${batchNum}/${totalBatches}]`;

    const html = isLastBatch
      ? buildSummaryEmailHtml(batchJobs, batchNum, totalBatches, {
          totalRaw:    totalRawCount,
          totalTitle:  totalTitleCount,
          totalFinal:  totalFinalCount,
          isLastToken: usingLastToken,
          tokenLabel:  activeTokenLabel,
        })
      : buildBatchEmailHtml(batchJobs, batchNum, totalBatches, {
          // Token warning on every batch so a mid-loop crash doesn't hide the critical alert
          isLastToken: usingLastToken,
          tokenLabel:  activeTokenLabel,
        });

    // Pass firstThreadId to batches 2+ so the Gmail API places them in the same thread.
    // threadId in requestBody is the only reliable threading mechanism for the Gmail REST API.
    const sendOpts = firstThreadId ? { threadId: firstThreadId } : {};

    try {
      const { messageId, threadId } = await sendEmailViaGmail(html, subject, sendOpts);
      sentCount++;
      if (!firstThreadId) firstThreadId = threadId; // Anchor all subsequent batches
      console.log(`  Sent mail ${batchNum}/${totalBatches}${isLastBatch ? ' (Summary)' : ''}. Message ID: ${messageId}`);
    } catch (err) {
      // Log and continue - partial delivery is better than losing all remaining batches
      console.error(`  [Email Error] Failed to send batch ${batchNum}/${totalBatches}: ${err.message}`);
    }

    // Small delay between sends to avoid Gmail API rate limits
    if (!isLastBatch) await sleep(1500);
  }

  // If every batch failed (e.g. expired credentials, network outage), exit non-zero so
  // cron / monitoring systems detect a real failure rather than silent success.
  if (sentCount === 0) {
    throw new Error(`Failed to deliver any batch emails (0/${totalBatches} sent). Check Gmail API credentials and network connectivity.`);
  }

  console.log(`\n=== DIGEST COMPLETE - ${sentCount}/${totalBatches} email(s) sent ===`);
}

main().catch((err) => {
  console.error('FAILED:', err.message);
  process.exit(1);
});
