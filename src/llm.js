// src/llm.js
// LLM-based JD experience filter using Groq's OpenAI-compatible API.
// Tries models in order; falls back to the next on any error.

'use strict';

const {
  GROQ_API_KEY,
  GROQ_MODELS,
  GROQ_ENDPOINT,
  JD_SYSTEM_PROMPT,
} = require('./config');

// Maximum characters of JD text sent to the model to avoid token blowout.
const JD_MAX_CHARS = 6000;

/**
 * Sends a job description to the LLM fallback chain and returns:
 *   1 — keep   (experience < 2 yrs mentioned, OR no experience mentioned)
 *   0 — exclude (experience ≥ 2 yrs mentioned)
 *
 * Fall-through behaviour:
 *   - If GROQ_API_KEY is not set → returns 1 (skip check, keep job).
 *   - If descriptionText is empty → returns 1 (no data, keep job).
 *   - If all models fail → returns 1 (fail-safe: never silently drop jobs
 *     due to API issues).
 *
 * @param {string} descriptionText  The raw `descriptionText` field from Apify.
 * @returns {Promise<0|1>}
 */
async function checkJDWithLLM(descriptionText) {
  if (!GROQ_API_KEY) {
    return 1; // Key not configured — skip LLM check.
  }

  const text = (descriptionText || '').trim();
  if (!text) {
    return 1; // No description available — keep job.
  }

  for (const model of GROQ_MODELS) {
    try {
      const resp = await fetch(GROQ_ENDPOINT, {
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
          max_tokens: 5,
          temperature: 0,
        }),
      });

      if (!resp.ok) {
        const errBody = await resp.text().catch(() => String(resp.status));
        console.warn(`  [LLM] ${model} HTTP ${resp.status}: ${errBody} — trying next model`);
        continue;
      }

      const data = await resp.json();
      const raw  = (data?.choices?.[0]?.message?.content || '').trim();

      if (raw === '1' || raw === '0') return parseInt(raw, 10);

      // Try to salvage slightly verbose responses (e.g. "1." or "0\n").
      if (raw.startsWith('1')) return 1;
      if (raw.startsWith('0')) return 0;

      console.warn(`  [LLM] ${model} returned unexpected output: "${raw}" — trying next model`);
    } catch (err) {
      console.warn(`  [LLM] ${model} error: ${err.message} — trying next model`);
    }
  }

  // All models failed — default to keep.
  console.warn('  [LLM] All models failed — defaulting to keep (1).');
  return 1;
}

module.exports = { checkJDWithLLM };
