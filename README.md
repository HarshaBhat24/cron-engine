# LinkedIn Job Digest

Fetch cybersecurity jobs posted on LinkedIn in the last 24 hours, apply a
lightweight title filter, and send the matching roles by email through the
Gmail API. Sent messages are marked as **Important**. The script is designed
to run locally or from cron without an interactive session.

## How it works

For each configured location, the script:

1. Requests recent jobs from the Apify LinkedIn jobs scraper.
2. Keeps jobs whose title contains a configured security keyword.
3. Excludes titles containing the configured seniority terms.
4. Sends the results as an HTML email when at least one job matches.
5. Adds Gmail's `IMPORTANT` label to the sent message.

The default searches are cybersecurity roles in Bengaluru and Pune. Edit the
`SEARCHES` array in `job-digest.js` to change locations or search keywords.

## Requirements

- Node.js 18 or newer
- An [Apify](https://apify.com/) account and API token
- A Google Cloud project with the Gmail API enabled
- Gmail OAuth credentials for a **Desktop app**

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Create an Apify token

Create or copy an API token from the [Apify integrations
page](https://console.apify.com/settings/integrations).

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
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
GOOGLE_REFRESH_TOKEN=
TO_EMAIL=recipient@example.com
```

Never commit `.env` or share its values. The refresh token grants access to
the Gmail scopes approved during OAuth.

### 5. Generate a Gmail refresh token

Run this once on a machine where you can complete the Google consent flow:

```bash
npm run auth
```

Open the URL printed by the script, approve access, paste the returned code
into the terminal, and add the printed `GOOGLE_REFRESH_TOKEN=...` line to
`.env`.

### 6. Test the digest

```bash
npm start
```

The script prints the number of raw and matching jobs for each location. If
there are matches, it sends an email to `TO_EMAIL` and marks it Important. If
no jobs match, it skips sending an email.

## Scheduling with cron

Open the crontab editor:

```bash
crontab -e
```

Run the digest every day at 6:00 PM using absolute paths:

```cron
0 18 * * * cd /absolute/path/to/cron-job-search && /usr/bin/node job-digest.js >> digest.log 2>&1
```

Cron uses the host machine's timezone. Set the schedule according to that
timezone, or configure `TZ` in the crontab if supported by the system.

## Filtering configuration

The filter is intentionally heuristic:

- `SECURITY_KEYWORDS` controls the title keywords that qualify a job.
- `SENIORITY_EXCLUDE` controls title terms that disqualify a job. The default

  excludes `senior`, `sr.`, and `sr `.
- `CHECK_DESCRIPTION_YEARS` can optionally exclude jobs whose descriptions

  appear to require more than `MAX_YEARS` of experience. It is disabled by
  default because experience-year phrases can be ambiguous.

The current filter does not reliably identify titles such as Staff, Lead,
Principal, Director, Manager, or Architect unless those terms are added to
`SENIORITY_EXCLUDE`. It also cannot guarantee that a matching title is a
0-to-3-year role.

## Troubleshooting

- **Missing environment variable:** Confirm that `.env` exists and contains
  `APIFY_TOKEN` and `GOOGLE_REFRESH_TOKEN`.
- **Gmail authorization failure:** Generate a new refresh token with
  `npm run auth`. Tokens can be revoked when account access or OAuth settings
  change.
- **No email received:** Check the terminal output or `digest.log`; no email
  is sent when the filtered result is empty.
- **Scraper failure:** LinkedIn changes can affect the Apify actor independently
  of this project. Review the Apify response and actor status.

## Project files

- `job-digest.js` - fetches, filters, and emails jobs.
- `get-refresh-token.js` - performs the one-time Gmail OAuth flow.
- `env.example` - environment variable template.
