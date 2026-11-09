// test/filter.test.js
// Automated unit tests for job filtering and deduplication rules using Node's native test runner.

'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  passesTitleFilter,
  passesCompanyFilter,
  passesDescriptionYearsCheck,
  filterJobsByCompany,
  filterJobs,
  deduplicateJobs,
} = require('../src/filter');

describe('passesTitleFilter', () => {
  it('accepts entry-level cybersecurity titles', () => {
    const validTitles = [
      'Cyber Security Analyst',
      'Information Security Associate',
      'Junior SOC Analyst',
      'Penetration Tester',
      'IAM Engineer',
      'Incident Response Analyst',
      'Vulnerability Management Engineer',
      'DevSecOps Engineer',
      'Ethical Hacker',
      'AppSec Analyst',
      'SIEM Analyst',
      'Malware Analyst',
      'Application Security Engineer',
      'Cloud Security Engineer',
      'Security Operations Center (SOC) Analyst',
      'Information Security Engineer',
      'Network Security Engineer',
      'Security Researcher',
    ];

    for (const title of validTitles) {
      assert.equal(passesTitleFilter(title), true, `Expected "${title}" to pass`);
    }
  });

  it('normalizes titles with hyphens and underscores', () => {
    assert.equal(passesTitleFilter('IN_Cyber_Security_Analyst'), true);
    assert.equal(passesTitleFilter('Cloud-Security-Engineer'), true);
  });

  it('rejects senior, lead, executive, and management roles', () => {
    const excludedTitles = [
      'Senior Security Engineer',
      'Sr. Cyber Security Analyst',
      'Lead Penetration Tester',
      'Principal Security Architect',
      'Staff Security Engineer',
      'Security Manager',
      'Head of Cybersecurity',
      'Director of Information Security',
      'VP Information Security',
      'Chief Information Security Officer',
      'CISO',
      'SOC L2 Analyst',
      'SOC L3 Engineer',
      'Security Specialist',
      'Cybersecurity Specialist',
      'Cyber Security Advisor',
      'Security Compliance Officer',
      'Information Security Auditor',
      'Risk and Governance Analyst',
    ];

    for (const title of excludedTitles) {
      assert.equal(passesTitleFilter(title), false, `Expected "${title}" to be excluded`);
    }
  });

  it('rejects non-security roles even if entry level', () => {
    const nonSecurityTitles = [
      'Software Engineer',
      'Frontend React Developer',
      'Data Analyst',
      'DevOps Engineer',
      'Project Coordinator',
      'Software Associate',
      'Social Media Coordinator',
      'Miami City Planner',
      'William Shakespeare Scholar',
      'Parliamentary Assistant',
    ];

    for (const title of nonSecurityTitles) {
      assert.equal(passesTitleFilter(title), false, `Expected "${title}" to be rejected`);
    }
  });

  it('respects word boundaries and avoids partial-word false exclusions', () => {
    // "Staffordshire" contains "staff", but shouldn't trigger word boundary \bstaff\b
    assert.equal(passesTitleFilter('Staffordshire Cyber Analyst'), true);
  });

  it('handles empty, null, or undefined titles safely', () => {
    assert.equal(passesTitleFilter(''), false);
    assert.equal(passesTitleFilter(null), false);
    assert.equal(passesTitleFilter(undefined), false);
  });
});

describe('passesCompanyFilter', () => {
  it('blocks default excluded service firms', () => {
    const excluded = [
      'Infosys',
      'infosys limited',
      'Wipro',
      'Wipro Technologies',
      'Capgemini',
      'Capgemini India',
      'TCS',
      'tcs ion',
      'Tata Consultancy Services',
      'IBM',
      'IBM India',
    ];

    for (const company of excluded) {
      assert.equal(passesCompanyFilter(company), false, `Expected "${company}" to be excluded`);
    }
  });

  it('allows desired product and security companies', () => {
    const allowed = [
      'CrowdStrike',
      'Palo Alto Networks',
      'SentinelOne',
      'Microsoft',
      'Google',
      'Zscaler',
      'Razorpay',
      'Swiggy',
      'Cred',
    ];

    for (const company of allowed) {
      assert.equal(passesCompanyFilter(company), true, `Expected "${company}" to be allowed`);
    }
  });

  it('supports custom excluded company lists', () => {
    const customList = ['Amazon', 'Flipkart'];
    assert.equal(passesCompanyFilter('Amazon', customList), false);
    assert.equal(passesCompanyFilter('Flipkart Internet Pvt Ltd', customList), false);
    assert.equal(passesCompanyFilter('CrowdStrike', customList), true);
  });

  it('handles null, undefined, or non-string inputs safely', () => {
    assert.equal(passesCompanyFilter(null), true);
    assert.equal(passesCompanyFilter(undefined), true);
    assert.equal(passesCompanyFilter(123), true);
  });
});

describe('passesDescriptionYearsCheck', () => {
  it('allows job descriptions with 0 to 2 years experience', () => {
    const validJDs = [
      'Looking for a fresher or graduate with 0-2 years of experience.',
      'Candidates with 1 year of experience in SOC monitoring are preferred.',
      'Required: 2 years experience in network administration or security.',
      'Entry level role with training provided. No prior experience required.',
    ];

    for (const jd of validJDs) {
      assert.equal(passesDescriptionYearsCheck(jd), true);
    }
  });

  it('rejects job descriptions demanding > 2 years experience', () => {
    const seniorJDs = [
      'Candidate must have 3+ years of experience in penetration testing.',
      'Requires 4-6 years of experience in incident response.',
      'Minimum 5+ years working with SIEM tools.',
      'Seeking a professional with 10 years experience.',
      'Candidate must have 3+ yrs experience in penetration testing.',
      'Requires 5 yrs of SOC experience.',
      '10+ yrs in penetration testing.',
    ];

    for (const jd of seniorJDs) {
      assert.equal(passesDescriptionYearsCheck(jd), false, `Expected "${jd}" to be rejected`);
    }
  });

  it('does not false-flag college degree requirements as years of experience', () => {
    const degreeJDs = [
      'Requires a 4-year degree in Computer Science or related field.',
      'Candidate should have a 4-year Bachelor\'s degree.',
      'Must possess a 3-4 year diploma in IT.',
      'Bachelor\'s degree (4 years) required for entry level analyst.',
      '4 years degree in engineering preferred.',
    ];

    for (const jd of degreeJDs) {
      assert.equal(passesDescriptionYearsCheck(jd), true, `Expected degree requirement to be allowed: "${jd}"`);
    }

    // But if it demands both a degree and >2 years of experience, it must still be rejected
    assert.equal(
      passesDescriptionYearsCheck('Requires a 4-year degree and 5+ years of experience.'),
      false
    );
    assert.equal(
      passesDescriptionYearsCheck('4 years of experience and a Bachelor\'s degree required.'),
      false
    );
  });

  it('ignores company history mentions', () => {
    const historyJDs = [
      'We are an organization with 100+ years of history, seeking an entry-level analyst.',
      'Backed by 20+ years of financial experience.',
    ];

    for (const jd of historyJDs) {
      assert.equal(passesDescriptionYearsCheck(jd), true);
    }
  });

  it('handles missing or empty descriptions safely', () => {
    assert.equal(passesDescriptionYearsCheck(''), true);
    assert.equal(passesDescriptionYearsCheck(null), true);
    assert.equal(passesDescriptionYearsCheck(undefined), true);
  });
});

describe('deduplicateJobs', () => {
  it('deduplicates jobs by link', () => {
    const jobs = [
      { id: '1', title: 'SOC Analyst', companyName: 'Corp A', link: 'https://linkedin.com/jobs/view/1' },
      { id: '2', title: 'SOC Analyst', companyName: 'Corp A', link: 'https://linkedin.com/jobs/view/1' },
      { id: '3', title: 'Security Engineer', companyName: 'Corp B', link: 'https://linkedin.com/jobs/view/2' },
    ];

    const deduplicated = deduplicateJobs(jobs);
    assert.equal(deduplicated.length, 2);
    assert.equal(deduplicated[0].id, '1');
    assert.equal(deduplicated[1].id, '3');
  });

  it('deduplicates jobs by title and company if link is missing', () => {
    const jobs = [
      { title: 'Security Analyst', companyName: 'Acme Corp' },
      { title: 'security analyst', companyName: 'acme corp' },
      { title: 'Security Analyst', companyName: 'Beta Corp' },
    ];

    const deduplicated = deduplicateJobs(jobs);
    assert.equal(deduplicated.length, 2);
  });
});

describe('Dynamic Search Configuration', () => {
  it('falls back to default locations when SEARCH_LOCATIONS is unset', () => {
    const { DEFAULT_SEARCH_LOCATIONS, SEARCH_LOCATIONS } = require('../src/config');
    assert.deepEqual(DEFAULT_SEARCH_LOCATIONS, [
      'Bengaluru, Karnataka, India',
      'Pune, Maharashtra, India',
    ]);
    assert.ok(SEARCH_LOCATIONS.length >= 2);
  });

  it('exports valid SEARCHES array with location and keywords properties', () => {
    const { SEARCHES, SEARCH_KEYWORDS } = require('../src/config');
    assert.ok(Array.isArray(SEARCHES));
    assert.ok(SEARCHES.length >= 2);
    for (const search of SEARCHES) {
      assert.ok(search.location, 'Search should have location');
      assert.equal(search.keywords, SEARCH_KEYWORDS);
    }
  });
});

describe('Email Rendering & Helpers', () => {
  const {
    encodeMimeSubject,
    buildJobCard,
    buildSummaryEmailHtml,
    buildZeroResultEmailHtml,
  } = require('../src/email');

  it('encodes subjects with non-ASCII characters per RFC 2047', () => {
    assert.equal(encodeMimeSubject('Plain ASCII Subject'), 'Plain ASCII Subject');
    const encoded = encodeMimeSubject('⚡ Cybersecurity Jobs · Bengaluru');
    assert.ok(encoded.startsWith('=?UTF-8?B?'));
    assert.ok(encoded.endsWith('?='));
  });

  it('truncates long job descriptions in email card to avoid Gmail clipping', () => {
    const longDesc = 'A'.repeat(1200);
    const cardHtml = buildJobCard({
      title: 'SOC Analyst',
      companyName: 'Acme',
      link: 'https://example.com',
      descriptionText: longDesc,
    });
    assert.ok(!cardHtml.includes(longDesc), 'Full 1200-char description should not be present');
    assert.ok(cardHtml.includes('...'), 'Truncated text should end with ellipsis');
    assert.ok(cardHtml.includes('<table width="100%"'), 'Table layout should be used instead of flexbox');
  });

  it('includes company match column in summary stats card', () => {
    const summaryHtml = buildSummaryEmailHtml([], 1, 1, {
      totalRaw: 100,
      totalTitle: 20,
      totalCompany: 15,
      totalFinal: 5,
    });
    assert.ok(summaryHtml.includes('Company Match'), 'Should display Company Match column');
    assert.ok(summaryHtml.includes('>15<'), 'Should display company match count');
  });

  it('renders heartbeat email for zero results', () => {
    const zeroHtml = buildZeroResultEmailHtml({
      totalRaw: 50,
      totalTitle: 0,
      totalCompany: 0,
    });
    assert.ok(zeroHtml.includes('Daily Heartbeat'), 'Should display heartbeat subtitle');
    assert.ok(zeroHtml.includes('No new early-career roles passed filtering today'), 'Should display zero result message');
  });
});

describe('State Persistence & Cross-Run Deduplication', () => {
  const fs = require('fs');
  const path = require('path');
  const os = require('os');
  const {
    getJobKey,
    filterNewJobs,
    markJobsSeen,
    loadSeenJobs,
    saveSeenJobs,
    SEEN_TTL_MS,
  } = require('../src/state');

  it('generates consistent job keys', () => {
    assert.equal(getJobKey({ link: 'https://linkedin.com/jobs/view/100' }), 'https://linkedin.com/jobs/view/100');
    assert.equal(getJobKey({ title: 'SOC Analyst', companyName: 'Acme Corp' }), 'soc analyst|acme corp');
    assert.equal(getJobKey(null), '');
  });

  it('filters out previously seen jobs', () => {
    const seenMap = new Map();
    seenMap.set('https://linkedin.com/jobs/view/1', Date.now());

    const jobs = [
      { id: '1', link: 'https://linkedin.com/jobs/view/1', title: 'SOC Analyst' },
      { id: '2', link: 'https://linkedin.com/jobs/view/2', title: 'Security Engineer' },
    ];

    const newJobs = filterNewJobs(jobs, seenMap);
    assert.equal(newJobs.length, 1);
    assert.equal(newJobs[0].id, '2');
  });

  it('persists and loads seen jobs with 7-day TTL pruning', () => {
    const tempFile = path.join(os.tmpdir(), `test-state-${Date.now()}.json`);
    try {
      const seenMap = new Map();
      const now = Date.now();
      seenMap.set('recent-job', now);
      seenMap.set('old-job', now - (SEEN_TTL_MS + 1000)); // expired

      saveSeenJobs(seenMap, tempFile);

      const loaded = loadSeenJobs(tempFile);
      assert.equal(loaded.has('recent-job'), true);
      assert.equal(loaded.has('old-job'), false, 'Expired job should be pruned');
    } finally {
      if (fs.existsSync(tempFile)) {
        fs.unlinkSync(tempFile);
      }
    }
  });
});

