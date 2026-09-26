// src/llm.js
// Batch LLM-based JD experience screening using Groq's OpenAI-compatible API.

'use strict';

const {
  GROQ_API_KEY,
  GROQ_MODELS,
  GROQ_ENDPOINT,
  JD_SYSTEM_PROMPT,
} = require('./config');

const BATCH_MAX_DESC_CHARS = 4500;
const MAX_429_RETRIES = 1;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseGroqRetryMs(errText) {
  const secMatch = errText.match(/try again in ([\d.]+)s/i);
  if (secMatch) return Math.ceil(parseFloat(secMatch[1]) * 1000) + 300;

  const msMatch = errText.match(/try again in ([\d.]+)ms/i);
  if (msMatch) return Math.ceil(parseFloat(msMatch[1])) + 300;

  return null;
}

/**
 * Evaluates a batch of jobs in a single LLM request.
 * Returns an array of booleans corresponding to each job in jobsBatch (true = keep, false = exclude).
 *
 * @param {object[]} jobsBatch
 * @returns {Promise<boolean[]>}
 */
async function checkJDBatchWithLLM(jobsBatch) {
  if (!GROQ_API_KEY || !jobsBatch || jobsBatch.length === 0) {
    return (jobsBatch || []).map(() => true);
  }

  // Calculate per-job character limit to strictly cap total prompt size
  const maxCharsPerJob = Math.min(1200, Math.floor(BATCH_MAX_DESC_CHARS / jobsBatch.length));

  const itemsToEvaluate = jobsBatch.map((job, index) => {
    const desc = (job.description || job.descriptionText || job.text || '').trim();
    return {
      index,
      id: index,
      title: job.title || 'Unknown Title',
      company: job.companyName || 'Unknown Company',
      description: desc.slice(0, maxCharsPerJob),
    };
  });

  const prompt = `Evaluate the following batch of ${itemsToEvaluate.length} jobs for required experience level.

${itemsToEvaluate.map(item => `--- JOB ID ${item.id} ---
Title: ${item.title}
Company: ${item.company}
Description:
${item.description || '(No description provided)'}`).join('\n\n')}

Rules for each job:
- Return "verdict": 1 if required experience is LESS than 2 years (0-1 years, 0-2 years, entry level, freshers, graduate) OR if experience is NOT mentioned / description is missing.
- Return "verdict": 0 if required experience is 2 YEARS OR MORE (e.g. 2+, 3+, 2-5 years, senior experience, 3+ yrs).

Output MUST be a valid JSON object with key "results" containing an array of objects:
{"results": [{"id": 0, "verdict": 1, "reason": "short explanation"}, ...]}`;

  for (const model of GROQ_MODELS) {
    let retriesLeft = MAX_429_RETRIES;

    while (true) {
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
              { role: 'user', content: prompt },
            ],
            response_format: { type: 'json_object' },
            temperature: 0,
          }),
        });
      } catch (err) {
        console.warn(`  [LLM Error] ${model} network error: ${err.message}. Trying next model...`);
        break;
      }

      if (resp.status === 429) {
        const errText = await resp.text().catch(() => '');
        if (retriesLeft > 0) {
          const waitMs = parseGroqRetryMs(errText) ?? 4000;
          console.warn(`  [LLM Retry] ${model} rate-limited (429). Waiting ${(waitMs / 1000).toFixed(1)}s then retrying...`);
          await sleep(waitMs);
          retriesLeft--;
          continue;
        }
        console.warn(`  [LLM Fallback] ${model} rate limit retries exhausted. Trying next model...`);
        break;
      }

      if (!resp.ok) {
        const errBody = await resp.text().catch(() => String(resp.status));
        console.warn(`  [LLM Fallback] ${model} HTTP ${resp.status}: ${errBody.slice(0, 100)}. Trying next model...`);
        break;
      }

      let data;
      try {
        data = await resp.json();
      } catch (err) {
        console.warn(`  [LLM Error] ${model} JSON parse error: ${err.message}. Trying next model...`);
        break;
      }

      const content = data?.choices?.[0]?.message?.content || '';
      try {
        const parsed = JSON.parse(content);
        const resultsArr = parsed.results || parsed.jobs || (Array.isArray(parsed) ? parsed : null);

        if (Array.isArray(resultsArr)) {
          if (resultsArr.length < jobsBatch.length) {
            console.warn(`  [LLM Warning] ${model} returned ${resultsArr.length} items for batch of ${jobsBatch.length}. Missing items will default to KEPT.`);
          }

          const keepMap = new Map();
          for (const item of resultsArr) {
            const v = item.verdict === 1 || item.verdict === '1' || item.verdict === true;
            keepMap.set(Number(item.id), v);
            const jobObj = jobsBatch[Number(item.id)];
            if (jobObj) {
              const status = v ? 'KEPT' : 'EXCLUDED';
              console.log(`  [LLM Check] [Model: ${model}] "${jobObj.title}" @ "${jobObj.companyName || 'Unknown'}" -> ${status} | Reason: ${item.reason || 'Evaluated'}`);
            }
          }

          return jobsBatch.map((jobObj, idx) => {
            if (keepMap.has(idx)) {
              return keepMap.get(idx);
            }
            console.warn(`  [LLM Warning] Job #${idx} ("${jobObj.title}") was missing in LLM response. Defaulting to KEPT.`);
            return true;
          });
        }
      } catch (_) {
        console.warn(`  [LLM Warning] ${model} failed to parse batch output. Trying next model...`);
        break;
      }
      break;
    }
  }

  console.warn('  [LLM Warning] All fallback models failed for batch. Defaulting to keep all jobs in batch.');
  return jobsBatch.map(() => true);
}

module.exports = { checkJDBatchWithLLM, sleep };
