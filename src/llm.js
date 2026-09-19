// src/llm.js
// LLM-based JD experience filter using Groq's OpenAI-compatible API.
// Tries models in order; on 429 waits the Groq-specified retry time and
// retries the same model once before falling through to the next.

'use strict';

const {
  GROQ_API_KEY,
  GROQ_MODELS,
  GROQ_ENDPOINT,
  JD_SYSTEM_PROMPT,
} = require('./config');

// Maximum characters of JD text sent to the model to avoid token blowout.
const JD_MAX_CHARS = 6000;

// How many times to retry a single model after a 429 before moving on.
const MAX_429_RETRIES = 1;

// ---------- HELPERS ----------

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Parses the "Please try again in X.Xs" / "Xs" / "Xms" string that Groq
 * embeds in its 429 error body and returns a millisecond wait time.
 * Returns null if the string can't be parsed.
 *
 * @param {string} errText  Raw response body of the 429 response.
 * @returns {number|null}
 */
function parseGroqRetryMs(errText) {
  // e.g. "Please try again in 3.3675s"
  const secMatch = errText.match(/try again in ([\d.]+)s/i);
  if (secMatch) return Math.ceil(parseFloat(secMatch[1]) * 1000) + 300; // +300 ms buffer

  // e.g. "Please try again in 329.999999ms"
  const msMatch = errText.match(/try again in ([\d.]+)ms/i);
  if (msMatch) return Math.ceil(parseFloat(msMatch[1])) + 300;

  return null;
}

/**
 * Parses the model response and extracts the verdict from the expected
 * JSON format: {"verdict": 0} or {"verdict": 1}.
 *
 * Two-layer defence:
 *  1. JSON.parse() the content field directly.
 *  2. Regex salvage - in case the model wraps JSON in a markdown code
 *     block (```json ... ```) despite being told not to.
 *
 * Returns '0', '1', or null if nothing usable is found.
 *
 * @param {object} data  Parsed JSON response from the Groq API.
 * @returns {'0'|'1'|null}
 */
function extractAnswer(data) {
  const content = (data?.choices?.[0]?.message?.content || '').trim();
  if (!content) return null;

  // Layer 1 - direct JSON parse
  try {
    const parsed = JSON.parse(content);
    const v = parsed?.verdict;
    if (v === 0 || v === 1)   return String(v);
    if (v === '0' || v === '1') return v;
  } catch (_) {
    // fall through to regex salvage
  }

  // Layer 2 - regex salvage (handles ```json\n{...}\n``` wrapping)
  const m = content.match(/"verdict"\s*:\s*([01])/);
  if (m) return m[1];

  return null;
}

// ---------- MAIN EXPORT ----------

/**
 * Sends a job description to the LLM fallback chain and returns:
 *   1 - keep   (experience < 2 yrs mentioned, OR no experience mentioned)
 *   0 - exclude (experience ≥ 2 yrs mentioned)
 *
 * Fallback behaviour:
 *   - GROQ_API_KEY not set  → 1 (skip check, keep job)
 *   - descriptionText empty → 1 (no data, keep job)
 *   - 429 rate-limit        → wait the Groq-specified time, retry once,
 *                             then move to next model
 *   - empty / bad response  → move to next model immediately
 *   - all models fail       → 1 (fail-safe: never silently drop jobs due
 *                             to transient API issues)
 *
 * @param {string} descriptionText  The raw `descriptionText` field from Apify.
 * @returns {Promise<0|1>}
 */
async function checkJDWithLLM(descriptionText) {
  if (!GROQ_API_KEY) {
    return 1; // Key not configured - skip LLM check.
  }

  const text = (descriptionText || '').trim();
  if (!text) {
    return 1; // No description available - keep job.
  }

  for (const model of GROQ_MODELS) {
    let retriesLeft = MAX_429_RETRIES;

    while (true) { // eslint-disable-line no-constant-condition
      let resp;
      try {
        resp = await fetch(GROQ_ENDPOINT, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${GROQ_API_KEY}`,
          },
          body: JSON.stringify({
            model,
            messages: [
              { role: 'system', content: JD_SYSTEM_PROMPT },
              { role: 'user',   content: text.slice(0, JD_MAX_CHARS) },
            ],
            response_format: { type: 'json_object' }, // enforce structured JSON output
            max_tokens: 20,   // {"verdict":1} is 13 chars; 20 gives comfortable headroom
            temperature: 0,
          }),
        });
      } catch (err) {
        console.warn(`  [LLM] ${model} network error: ${err.message} - trying next model`);
        break; // move to next model
      }

      // ---- 429: rate-limited ----
      if (resp.status === 429) {
        const errText = await resp.text().catch(() => '');
        if (retriesLeft > 0) {
          const waitMs = parseGroqRetryMs(errText) ?? 5000;
          console.warn(`  [LLM] ${model} rate-limited - waiting ${(waitMs / 1000).toFixed(1)}s then retrying…`);
          await sleep(waitMs);
          retriesLeft--;
          continue; // retry same model
        }
        console.warn(`  [LLM] ${model} rate-limit retries exhausted - trying next model`);
        break;
      }

      // ---- Other HTTP error ----
      if (!resp.ok) {
        const errBody = await resp.text().catch(() => String(resp.status));
        console.warn(`  [LLM] ${model} HTTP ${resp.status}: ${errBody} - trying next model`);
        break;
      }

      // ---- Success: parse answer ----
      let data;
      try {
        data = await resp.json();
      } catch (err) {
        console.warn(`  [LLM] ${model} JSON parse error: ${err.message} - trying next model`);
        break;
      }

      const answer = extractAnswer(data);
      if (answer !== null) {
        return parseInt(answer, 10);
      }

      // extractAnswer found nothing useful
      const rawContent = (data?.choices?.[0]?.message?.content || '').trim();
      console.warn(
        `  [LLM] ${model} no usable verdict in response` +
        ` (content="${rawContent.slice(0, 60)}")` +
        ` - trying next model`
      );
      break;
    }
  }

  // All models failed - default to keep.
  console.warn('  [LLM] All models failed - defaulting to keep (1).');
  return 1;
}

module.exports = { checkJDWithLLM };
