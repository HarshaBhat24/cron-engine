// src/index.js
// Entry point - orchestrates fetch → title filter → deduplication → company filter → cross-run deduplication → LLM batch filter → email.

'use strict';

const {
  APIFY_TOKENS,
  GOOGLE_REFRESH_TOKEN,
  GROQ_API_KEY,
  SEARCHES,
  LLM_BATCH_SIZE,
  MAIL_BATCH_SIZE,
  SEND_EMPTY_DIGEST,
} = require('./config');
const { runApifySearch }   = require('./apify');
const { filterJobs, deduplicateJobs, passesCompanyFilter, evaluateJob } = require('./filter');
const { checkJDBatchWithLLM, sleep } = require('./llm');
const {
  buildBatchEmailHtml,
  buildSummaryEmailHtml,
  buildZeroResultEmailHtml,
  sendEmailViaGmail,
} = require('./email');
const {
  loadSeenJobs,
  saveSeenJobs,
  filterNewJobs,
  markJobsSeen,
} = require('./state');

async function sendZeroResultHeartbeat(stats) {
  const dateStr = new Date().toISOString().slice(0, 10);
  const cities = SEARCHES.map((s) => s.location.split(',')[0].trim());
  const locationLabel = cities.length <= 3 ? cities.join(' & ') : `${cities.slice(0, 2).join(' & ')} +${cities.length - 2} more`;
  const subject = `Cybersecurity Jobs (0-2 yrs) - ${locationLabel} - ${dateStr} [Heartbeat - 0 Jobs]`;
  const html = buildZeroResultEmailHtml(stats);
  try {
    const { messageId } = await sendEmailViaGmail(html, subject);
    console.log(`[Email] Zero-result heartbeat email sent. Message ID: ${messageId}`);
  } catch (err) {
    console.error(`[Email Error] Failed to send heartbeat email: ${err.message}`);
  }
}

function getJobDetails(job) {
  return {
    title: (job && job.title) || 'Unknown Title',
    company: (job && (job.companyName || job.company)) || 'Unknown Company',
    link: (job && (job.link || job.jobUrl || job.url)) || 'No link available',
    location: (job && (job._location || job.location || '')).split(',')[0].trim() || 'Unknown Location',
  };
}

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

  const seenJobs = loadSeenJobs();
  const allTitleFiltered = [];
  let totalRawCount = 0;

  // Step 1 & 2: Scrape and apply synchronous Title Filter per location with individual error boundaries
  let usingLastToken = false;
  let activeTokenLabel = '';
  for (const search of SEARCHES) {
    try {
      console.log(`\n--- Fetching Location: ${search.location} ---`);
      const { jobs: rawJobs, isLastToken, tokenLabel } = await runApifySearch(search);
      if (isLastToken) {
        usingLastToken = true;
        activeTokenLabel = tokenLabel;
      }
      totalRawCount += rawJobs.length;

    console.log(`\n  --- Evaluated All ${rawJobs.length} Search Result(s) for ${search.location} ---`);
    const titleFiltered = [];

    rawJobs.forEach((job, idx) => {
      const { title, company, link } = getJobDetails(job);
      const evalResult = evaluateJob(job);
      const statusLabel = evalResult.passed ? '✓ PASSED' : `✗ REJECTED (${evalResult.reason})`;

      console.log(`  ${idx + 1}. [${statusLabel}] "${title}" @ "${company}"`);
      console.log(`     Link: ${link}`);

      if (evalResult.passed) {
        if (!job._location) job._location = search.location;
        titleFiltered.push(job);
      }
    });

    console.log(`  => [Summary for ${search.location}] ${rawJobs.length} raw jobs evaluated -> ${titleFiltered.length} passed title & description filter.`);

    rawJobsByLocation.push({ location: search.location, titleJobs: titleFiltered });
    allTitleFiltered.push(...titleFiltered);
  }

  // Step 3: Deduplicate candidate listings across locations
  const seenKeys = new Set();
  const uniqueTitleJobs = [];
  const duplicateJobs = [];

  for (const job of allTitleFiltered) {
    const key = job.link || job.id || `${(job.title || '').toLowerCase().trim()}|${(job.companyName || job.company || '').toLowerCase().trim()}`;
    if (seenKeys.has(key)) {
      duplicateJobs.push(job);
    } else {
      seenKeys.add(key);
      uniqueTitleJobs.push(job);
    }
  }

  const totalTitleCount = uniqueTitleJobs.length;
  console.log(`\n[Deduplication] Combined ${allTitleFiltered.length} candidate listings into ${uniqueTitleJobs.length} unique jobs.`);
  if (duplicateJobs.length > 0) {
    console.log(`  Excluded ${duplicateJobs.length} duplicate listing(s) seen across locations:`);
    duplicateJobs.forEach((job, idx) => {
      const { title, company, link } = getJobDetails(job);
      console.log(`    ${idx + 1}. [DUPLICATE] "${title}" @ "${company}"`);
      console.log(`       Link: ${link}`);
    });
  }

  if (uniqueTitleJobs.length === 0) {
    console.log('\nNo matching jobs found after title filter.');
    if (SEND_EMPTY_DIGEST) {
      await sendZeroResultHeartbeat({
        totalRaw: totalRawCount,
        totalTitle: 0,
        totalCompany: 0,
        isLastToken: usingLastToken,
        tokenLabel: activeTokenLabel,
      });
    }
    return;
  }

  // Step 4: Company Filter (after title filter, before LLM filter)
  const candidateJobs = [];
  const excludedByCompany = [];
  for (const job of uniqueTitleJobs) {
    const { title, company, link } = getJobDetails(job);
    if (passesCompanyFilter(company)) {
      candidateJobs.push(job);
    } else {
      excludedByCompany.push(job);
      console.log(`  [Company Filter] ✗ REJECTED: "${title}" @ "${company}" (matched company exclusion rule)`);
      console.log(`                   Link: ${link}`);
    }
  }
  const totalCompanyCount = candidateJobs.length;
  console.log(`\n[Company Filter] ${uniqueTitleJobs.length} unique jobs -> ${totalCompanyCount} passed company criteria (excluded ${excludedByCompany.length}).`);

  if (candidateJobs.length === 0) {
    console.log('\nNo matching jobs found after company filter.');
    if (SEND_EMPTY_DIGEST) {
      await sendZeroResultHeartbeat({
        totalRaw: totalRawCount,
        totalTitle: totalTitleCount,
        totalCompany: 0,
        isLastToken: usingLastToken,
        tokenLabel: activeTokenLabel,
      });
    }
    return;
  }

  // Step 5: Cross-Run Deduplication (avoid re-screening jobs emailed within the last 7 days)
  const unseenCandidateJobs = filterNewJobs(candidateJobs, seenJobs);
  const previouslySeenCount = candidateJobs.length - unseenCandidateJobs.length;
  if (previouslySeenCount > 0) {
    console.log(`\n[State] Filtered out ${previouslySeenCount} job(s) already processed in the last 7 days.`);
  }

  if (unseenCandidateJobs.length === 0) {
    console.log('\nAll candidate jobs were already processed in previous runs - skipping email.');
    if (SEND_EMPTY_DIGEST) {
      await sendZeroResultHeartbeat({
        totalRaw: totalRawCount,
        totalTitle: totalTitleCount,
        totalCompany: totalCompanyCount,
        isLastToken: usingLastToken,
        tokenLabel: activeTokenLabel,
      });
    }
    return;
  }

  // Step 6: LLM Batch Screening on unseen candidate jobs
  let uniqueApprovedJobs = [];
  if (!GROQ_API_KEY) {
    uniqueApprovedJobs = unseenCandidateJobs;
  } else {
    console.log(`\n--- LLM Screening (${unseenCandidateJobs.length} candidate jobs, Batch size: ${LLM_BATCH_SIZE}) ---`);

    for (let i = 0; i < unseenCandidateJobs.length; i += LLM_BATCH_SIZE) {
      if (i > 0) await sleep(1000);
      const batch = unseenCandidateJobs.slice(i, i + LLM_BATCH_SIZE);
      const verdicts = await checkJDBatchWithLLM(batch);

      batch.forEach((job, idx) => {
        if (verdicts[idx]) uniqueApprovedJobs.push(job);
      });
    }
    console.log(`[LLM Summary] ${unseenCandidateJobs.length} candidates -> ${uniqueApprovedJobs.length} passed LLM experience requirements.`);
  }

  const totalFinalCount = uniqueApprovedJobs.length;
  if (totalFinalCount === 0) {
    console.log('\nNo matching jobs today after LLM screening.');
    if (SEND_EMPTY_DIGEST) {
      await sendZeroResultHeartbeat({
        totalRaw: totalRawCount,
        totalTitle: totalTitleCount,
        totalCompany: totalCompanyCount,
        isLastToken: usingLastToken,
        tokenLabel: activeTokenLabel,
      });
    }
    return;
  }

  // Print all approved jobs to console with Title, Company, Location, and Link
  console.log(`\n==================================================`);
  console.log(`           APPROVED JOBS FOR DIGEST (${totalFinalCount})`);
  console.log(`==================================================`);
  uniqueApprovedJobs.forEach((job, idx) => {
    const { title, company, link, location } = getJobDetails(job);
    console.log(`  ${idx + 1}. Title:    ${title}`);
    console.log(`     Company:  ${company} [${location}]`);
    console.log(`     Link:     ${link}`);
    if (idx < totalFinalCount - 1) console.log('');
  });
  console.log(`==================================================\n`);

  // Sort by location so jobs from the same city land in the same batch where possible.
  uniqueApprovedJobs.sort((a, b) => (a._location || '').localeCompare(b._location || ''));

  // Step 7: Send batched HTML digest emails
  const dateStr      = new Date().toISOString().slice(0, 10);
  const totalBatches = Math.ceil(uniqueApprovedJobs.length / MAIL_BATCH_SIZE);

  console.log(`\n--- Sending ${totalBatches} email(s) (${MAIL_BATCH_SIZE} jobs/mail, last mail = summary) ---`);

  let sentCount    = 0;
  let firstThreadId = null; // Captured from batch 1; passed to batches 2+ for Gmail threading

  for (let i = 0; i < totalBatches; i++) {
    const batchNum    = i + 1;
    const batchJobs   = uniqueApprovedJobs.slice(i * MAIL_BATCH_SIZE, (i + 1) * MAIL_BATCH_SIZE);
    const isLastBatch = batchNum === totalBatches;

    const cities = SEARCHES.map((s) => s.location.split(',')[0].trim());
    const locationLabel = cities.length <= 3 ? cities.join(' & ') : `${cities.slice(0, 2).join(' & ')} +${cities.length - 2} more`;

    const subject = isLastBatch
      ? `Cybersecurity Jobs (0-2 yrs) - ${locationLabel} - ${dateStr} [${batchNum}/${totalBatches} - Summary]`
      : `Cybersecurity Jobs (0-2 yrs) - ${locationLabel} - ${dateStr} [${batchNum}/${totalBatches}]`;

    const html = isLastBatch
      ? buildSummaryEmailHtml(batchJobs, batchNum, totalBatches, {
          totalRaw:     totalRawCount,
          totalTitle:   totalTitleCount,
          totalCompany: totalCompanyCount,
          totalFinal:   totalFinalCount,
          isLastToken:  usingLastToken,
          tokenLabel:   activeTokenLabel,
        })
      : buildBatchEmailHtml(batchJobs, batchNum, totalBatches, {
          isLastToken:  usingLastToken,
          tokenLabel:   activeTokenLabel,
        });

    const sendOpts = firstThreadId ? { threadId: firstThreadId } : {};

    try {
      const { messageId, threadId } = await sendEmailViaGmail(html, subject, sendOpts);
      sentCount++;
      if (!firstThreadId) firstThreadId = threadId; // Anchor all subsequent batches
      console.log(`  Sent mail ${batchNum}/${totalBatches}${isLastBatch ? ' (Summary)' : ''}. Message ID: ${messageId}`);
    } catch (err) {
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

  // Record sent jobs in persistent state to prevent re-sending in future runs
  markJobsSeen(uniqueApprovedJobs, seenJobs);
  saveSeenJobs(seenJobs);

  console.log(`\n=== DIGEST COMPLETE - ${sentCount}/${totalBatches} email(s) sent ===`);
}

main().catch((err) => {
  console.error('FAILED:', err.message);
  process.exit(1);
});
