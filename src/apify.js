// src/apify.js
// Responsible for fetching raw job listings from the Apify LinkedIn scraper.
// Implements a token-fallback strategy: APIFY_TOKEN → APIFY_TOKEN_2 → … (auto-discovered).
// Tokens are cached per process-run to avoid redundant quota API calls (Fix #4).

'use strict';

const { APIFY_TOKENS } = require('./config');

// ── Quota helper ───────────────────────────────────────────────────────────────

/**
 * Returns the remaining monthly credit (USD) for a given token value.
 *
 * Apify's /v2/users/me response shape:
 *   data.plan.monthlyUsageCreditsUsd  → monthly credit limit
 *   data.monthlyUsage.totalUsd        → amount used so far this month
 *
 * Returns:
 *   - Positive number  → token has remaining quota
 *   - 0                → token is genuinely exhausted (used >= limit) or 401/403
 *   - Infinity         → couldn't reach the API (network error / timeout);
 *                        assume valid and let the scrape attempt decide.
 *
 * @param {string} tokenValue
 * @returns {Promise<number>}
 */
async function getRemainingQuota(tokenValue) {
  try {
    const resp = await fetch(
      `https://api.apify.com/v2/users/me?token=${tokenValue}`,
      { signal: AbortSignal.timeout(10_000) }
    );

    // 401 / 403 → bad/expired token, skip it
    if (resp.status === 401 || resp.status === 403) return 0;

    // Any other non-OK status → don't penalise the token, assume valid
    if (!resp.ok) return Infinity;

    const { data } = await resp.json();

    const limit = data?.plan?.monthlyUsageCreditsUsd;
    const used  = data?.monthlyUsage?.totalUsd;

    // Unknown response shape → assume valid
    if (limit == null || used == null) return Infinity;

    return Math.max(0, limit - used);
  } catch {
    // Network error, timeout, DNS failure → assume valid; let the scraper decide.
    return Infinity;
  }
}

// ── Token cache (Fix #4) ───────────────────────────────────────────────────────
// Caches the array index of the last successfully used token within a single
// process run. Prevents redundant quota API calls for every search location.
// -1 means "not yet resolved" → will do a fresh scan on the first call.
let _cachedIdx = -1;

// ── Internal: find the next usable token from a given index ───────────────────

/**
 * Walks APIFY_TOKENS starting at `fromIndex`, checks quota for each, and
 * returns the first one with quota remaining.
 *
 * @param {number} fromIndex
 * @returns {Promise<{index: number, key: string, value: string, isLastToken: boolean} | null>}
 */
async function findUsableToken(fromIndex) {
  for (let i = fromIndex; i < APIFY_TOKENS.length; i++) {
    const { key, value } = APIFY_TOKENS[i];   // Fix #1: key comes from {key,value} pair
    const remaining = await getRemainingQuota(value);

    if (remaining > 0) {
      const isLastToken = i === APIFY_TOKENS.length - 1;
      const display = remaining === Infinity
        ? 'quota API unreachable – assuming valid'
        : `$${remaining.toFixed(3)} USD remaining`;
      console.log(`[Apify] Using ${key} (${display})${isLastToken ? ' ⚠️  LAST TOKEN' : ''}`);
      return { index: i, key, value, isLastToken };
    }

    console.warn(`[Apify] ${key} is exhausted ($0 remaining) – trying next token…`);
  }
  return null; // all tokens from fromIndex onward are exhausted
}

// ── Main scrape function ───────────────────────────────────────────────────────

/**
 * Runs the Apify LinkedIn jobs scraper for a single search configuration.
 *
 * Token selection strategy (fixes #1, #2, #4):
 *  1. Re-uses the cached token from the previous successful call without
 *     re-hitting the quota API (saves N-1 HTTP calls per run).
 *  2. If the cached token is rejected at scrape time (401 / 402 / 403),
 *     invalidates the cache and falls through to the next token with quota.
 *  3. Labels always come from the original env var key (e.g. APIFY_TOKEN_5),
 *     never reconstructed from array index.
 *  4. Throws only when all tokens are exhausted or a non-auth HTTP error occurs.
 *
 * @param {{ location: string, keywords: string }} search
 * @returns {Promise<{ jobs: object[], isLastToken: boolean, tokenLabel: string }>}
 */
async function runApifySearch({ location, keywords }) {
  if (APIFY_TOKENS.length === 0) {
    throw new Error('No Apify tokens configured. Set at least APIFY_TOKEN in .env');
  }

  const runInput = {
    autoConvertToAiSearch: true,
    datePosted: 'past24Hours',
    keywords,
    limitPerSource: 250,
    location,
    scrapeCompany: false,
  };

  // Start from the cached index if available; otherwise scan from the beginning.
  let startIdx = _cachedIdx >= 0 ? _cachedIdx : 0;

  while (startIdx < APIFY_TOKENS.length) {
    // Use the cached token directly (no quota re-check) or find the next valid one.
    let tokenInfo;
    if (startIdx === _cachedIdx) {
      // Cached token: skip quota re-check, go straight to scrape attempt
      const { key, value } = APIFY_TOKENS[startIdx];
      tokenInfo = { index: startIdx, key, value, isLastToken: startIdx === APIFY_TOKENS.length - 1 };
    } else {
      tokenInfo = await findUsableToken(startIdx);
    }

    if (!tokenInfo) break; // every remaining token is exhausted

    const { index, key, value, isLastToken } = tokenInfo;

    // ── Attempt the actual scrape ─────────────────────────────────────────────
    const resp = await fetch(
      `https://api.apify.com/v2/acts/curious_coder~linkedin-jobs-scraper/run-sync-get-dataset-items?token=${value}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(runInput),
      }
    );

    // Fix #2: auth/quota rejection at scrape time → invalidate cache, try next token
    if (resp.status === 401 || resp.status === 402 || resp.status === 403) {
      console.warn(
        `[Apify] ${key} rejected by scraper (HTTP ${resp.status}) – trying next token…`
      );
      _cachedIdx = -1;        // invalidate cache
      startIdx = index + 1;   // advance past this token
      continue;
    }

    // Non-auth error (e.g. 500 server error) – not a token issue, throw immediately
    if (!resp.ok) {
      throw new Error(
        `Apify run failed for ${location}: ${resp.status} ${await resp.text()}`
      );
    }

    // ── Success ───────────────────────────────────────────────────────────────
    _cachedIdx = index; // update cache so next location skips quota re-check
    const jobs = await resp.json();
    return { jobs, isLastToken, tokenLabel: key };
  }

  throw new Error(
    'All Apify tokens are exhausted or invalid. ' +
    'Please top up one of the accounts or add a new token.'
  );
}

module.exports = { runApifySearch };
