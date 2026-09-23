# LinkedIn Job Digest

Fetch cybersecurity jobs posted on LinkedIn in the last 24 hours, apply a lightweight title filter, run an LLM-based Job Description (JD) experience check via Groq, and send the matching roles by email through the Gmail API. Sent messages are marked as **Important**. The script is designed to run locally or from cron without an interactive session.

## How it works

For each configured location, the script:

1. Requests recent jobs from the Apify LinkedIn jobs scraper (`descriptionText`).
2. Applies a synchronous title filter (must include security keywords, exclude seniority keywords).
3. Evaluates matching JDs via an **LLM fallback chain** (Groq API) to determine if experience required is `< 2 years` or unspecified (`verdict: 1`), vs `≥ 2 years` (`verdict: 0`).
4. Sends the filtered results as an HTML email when at least one job matches.
5. Adds Gmail's `IMPORTANT` label to the sent message.

The default searches target cybersecurity roles in Bengaluru and Pune. Edit the `SEARCHES` array in `job-digest.js` to change locations or search keywords.

## LLM Experience Screening & Fallback Chain

The second-layer filter evaluates the raw JD text using Groq's OpenAI-compatible API in strict **JSON mode** (`response_format: { type: "json_object" }`).

If a model encounters a rate limit (HTTP 429), API error, or unexpected output, it automatically falls back to the next model in sequence:

1. `llama-3.3-70b-versatile`
2. `llama-3.1-8b-instant`
3. `mixtral-8x7b-32768`
4. `gemma2-9b-it`

> **Note:** If `GROQ_API_KEY` is not set or all models in the fallback chain fail, the script defaults to keeping the job (`verdict: 1`) so no valid listings are silently lost.

## Requirements

- Node.js 18 or newer
- An [Apify](https://apify.com/) account and API token
- A [Groq](https://console.groq.com/) API key
- A Google Cloud project with the Gmail API enabled
- Gmail OAuth credentials for a **Desktop app**

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Create API tokens

- **Apify**: Copy an API token from the [Apify integrations page](https://console.apify.com/settings/integrations).
- **Groq**: Create an API key on the [Groq Console](https://console.groq.com/keys).

### 3. Configure Gmail API access

1. Open [Google Cloud Credentials](https://console.cloud.google.com/apis/credentials).
2. Create a project or select an existing one.
3. Enable the Gmail API for the project.
4. Create OAuth client credentials with application type **Desktop app**.
5. Copy the client ID and client secret.

### 4. Create the environment file

```bash
cp env.example .env
```

Fill in `.env`:

```dotenv
APIFY_TOKEN=your_apify_token
GROQ_API_KEY=your_groq_api_key
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
GOOGLE_REFRESH_TOKEN=
TO_EMAIL=recipient@example.com
```

Never commit `.env` or share its values.

### 5. Generate a Gmail refresh token

Run this once on a machine where you can complete the Google consent flow:

```bash
npm run auth
```

Open the URL printed by the script, approve access, paste the returned code into the terminal, and add the printed `GOOGLE_REFRESH_TOKEN=...` line to `.env`.

> **Note:** For Google Cloud projects in **Testing** publishing status, refresh tokens expire every 7 days. Move your OAuth consent screen status to **In Production** to avoid periodic re-authorization.

### 6. Test the digest

```bash
npm start
```

The script prints the number of raw, title-filtered, and LLM-filtered jobs for each location. If there are matches, it sends an email to `TO_EMAIL` and marks it Important.

## Scheduling with cron

Open the crontab editor:

```bash
crontab -e
```

Run the digest every day at 6:00 PM using absolute paths:

```cron
0 18 * * * cd /absolute/path/to/cron-job-search && /usr/bin/node job-digest.js >> digest.log 2>&1
```

## Project Structure

- `job-digest.js` - Main entry point; orchestrates scraper, title filtering, Groq LLM check, and email dispatch.
- `get-refresh-token.js` - Performs the one-time Gmail OAuth flow (`npm run auth`).
- `.github/workflows/digest.yml` - GitHub Actions workflow schedule.
- `env.example` - Environment variable template.

## Troubleshooting

- **Missing environment variable:** Confirm that `.env` exists and contains `APIFY_TOKEN`, `GROQ_API_KEY`, and `GOOGLE_REFRESH_TOKEN`.
- **Gmail authorization failure / invalid_grant:** Generate a new refresh token with `npm run auth`. If the app is in Google Cloud "Testing" mode, publish it to "Production".
- **LLM Rate Limits (HTTP 429):** The script automatically pauses based on `Retry-After` headers and retries or moves to the next model in the chain.
- **No email received:** Check terminal output or `digest.log`; no email is sent when the filtered result is empty.

