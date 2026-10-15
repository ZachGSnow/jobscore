// @vitest-environment jsdom
// The site scrapers, against small DOMs shaped like the real pages. The handles
// (data-testid, data-automation-id, href shapes) are the ones the README says were
// confirmed; class names that rotate are never used.
import assert from 'node:assert/strict';
import { beforeEach, test } from 'vitest';
import * as J from '../src/all.js';

const win = (url) => { const u = new URL(url); return { location: { hostname: u.hostname, href: u.href } }; };
const set = (html) => { document.head.innerHTML = ''; document.body.innerHTML = html; document.title = ''; };
beforeEach(() => set(''));

const POSTING = 'About the role. Responsibilities: run technical discovery and demos. Qualifications: 3+ years of experience. ' +
  'Compensation: base salary $140,000 - $160,000. Location: Remote. '.repeat(1) + 'We build firewall and backup software. '.repeat(30);

test('Workday: every <dd> location is kept, the label is stripped, the header is read from its handles', () => {
  set(`
    <h2 data-automation-id="jobPostingHeader">Senior Sales Engineer</h2>
    <div data-automation-id="companyName">Arctic Wolf&nbsp;</div>
    <dl data-automation-id="locations"><dt>locations</dt><dd>Remote, United States</dd><dd>Remote - USA - Ohio</dd></dl>
    <div data-automation-id="jobPostingDescription"><div>${POSTING}</div></div>`);
  const page = J.extractPosting(document, win('https://arcticwolf.wd1.myworkdayjobs.com/en-US/External/job/x/Senior-Sales-Engineer_R1'));
  assert.equal(page.site, 'Workday');
  assert.equal(page.title, 'Senior Sales Engineer');
  assert.equal(page.company, 'Arctic Wolf');
  assert.match(page.location, /Remote, United States/);
  assert.match(page.location, /Ohio/, 'taking only the first <dd> would drop the one that matters');
  assert.ok(page.body_length > 300);
});

test('LinkedIn: a results-list card with the same data-testid cannot supply the posting or the title', () => {
  set(`
    <ul>
      <li><a href="/jobs/view/111/">Account Executive</a>
        <div data-testid="expandable-text-box">For our client, we are seeking an Account Executive to join the team.</div></li>
    </ul>
    <section class="pane">
      <a href="/company/acme/">Acme Security</a>
      <a href="/jobs/view/222/">Solutions Engineer</a>
      <div data-testid="expandable-text-box">${POSTING}</div>
    </section>`);
  const page = J.extractPosting(document, win('https://www.linkedin.com/jobs/search/?currentJobId=222'));
  assert.equal(page.site, 'LinkedIn');
  assert.ok(page.body_length > 1000, 'the whole posting, not the 80-character card');
  assert.match(page.body, /technical discovery/);
});

test('Greenhouse: the title, location and body come from the job__ handles', () => {
  set(`
    <div class="job__title"><h1 class="section-header">Sr. Solutions Architect</h1></div>
    <div class="job__location"><svg></svg>United States of America</div>
    <div class="job__description">${POSTING}</div>`);
  const page = J.extractPosting(document, win('https://job-boards.greenhouse.io/wasabi/jobs/5392451008'));
  assert.equal(page.title, 'Sr. Solutions Architect');
  assert.match(page.location, /United States of America/);
  assert.equal(page.company, 'Wasabi', 'read off the board path when the page names no employer');
  assert.equal(page.company_source, 'url');
});

function indeedPane(jobKey) {
  return `
    <div class="cards"><h3 class="jobTitle"><span title="Sales Manager">Sales Manager</span></h3></div>
    <div data-testid="viewjob-main-content">
      <h2 data-testid="vj-job-title">Solutions Engineer</h2>
      <div data-testid="company-info-metadata"><div><a href="/cmp/Newrocket?fromjk=${jobKey}">NewRocket</a></div><div>Vista, CA</div><div>\u2022</div><div>Remote</div></div>
      <div data-testid="structured-job-summary"><h3>Job details</h3><div>Pay</div><div>$160,000 - $185,000 a year</div></div>
      <div class="simple-job-description-html">${POSTING}</div>
    </div>`;
}

test('Indeed: read from the open pane only, pay comes from the Job details block', () => {
  set(indeedPane('abc123'));
  const page = J.extractPosting(document, win('https://www.indeed.com/jobs?q=se&vjk=abc123'));
  assert.equal(page.strict, true);
  assert.equal(page.title, 'Solutions Engineer', 'not the "Sales Manager" card');
  assert.equal(page.company, 'NewRocket');
  assert.match(page.location, /Vista, CA/);
  assert.match(page.body, /=== JOB DETAILS/);
  assert.match(page.pay_block, /\$160,000/);
  assert.equal(page.pane_stale, false);
});

test('Indeed: a pane still showing another job is flagged stale and blocks scoring', () => {
  set(indeedPane('deadbeef01'));
  const page = J.extractPosting(document, win('https://www.indeed.com/jobs?q=se&vjk=abc123'));
  assert.equal(page.pane_stale, true);
  assert.ok(J.extractionIssues(page).blockers.some((b) => b.id === 'pane_stale'));
});

test('Indeed: no pane yet means "not captured", never a guess from the page', () => {
  set('<h1>Solutions Engineer jobs in Remote</h1><div class="cards"></div>');
  const page = J.extractPosting(document, win('https://www.indeed.com/jobs?q=se&vjk=abc123'));
  assert.equal(page.pane_found, false);
  assert.equal(page.title, null, 'the search heading must never become the job title');
  assert.ok(J.extractionIssues(page).blockers.some((b) => b.id === 'pane_missing'));
});

test('an unlisted careers page uses ld+json when the selectors only find a fragment', () => {
  const full = POSTING + ' Responsibilities and qualifications are listed below. '.repeat(10);
  set(`
    <script type="application/ld+json">${JSON.stringify({
      '@type': 'JobPosting', title: 'Junior Solutions Engineer', hiringOrganization: { name: 'Trellix' },
      jobLocation: { address: { addressLocality: 'Remote', addressCountry: 'US' } }, description: '<p>' + full + '</p>',
    })}</script>
    <main><p>Apply now. We are hiring.</p></main>`);
  const page = J.extractPosting(document, win('https://careers.trellix.com/jobs/junior-solutions-engineer/'));
  assert.equal(page.site, 'generic');
  assert.equal(page.selector_used, 'ld+json description');
  assert.match(page.body, /technical discovery/);
  assert.equal(page.title, 'Junior Solutions Engineer');
  assert.equal(page.company, 'Trellix');
});

test('an unlisted page whose selectors find a whole posting keeps them over ld+json', () => {
  set(`
    <script type="application/ld+json">${JSON.stringify({ '@type': 'JobPosting', title: 'SE', description: 'short' })}</script>
    <main>${POSTING + ' Qualifications and responsibilities. '.repeat(40)}</main>`);
  const page = J.extractPosting(document, win('https://example.com/careers/1'));
  assert.notEqual(page.selector_used, 'ld+json description');
});

test('the card prefilter dims a failing Indeed card, honours settings, and never adds a node', () => {
  set(`
    <div class="cardOutline result" id="a"><h3 class="jobTitle"><span title="Sales Manager">Sales Manager</span></h3>
      <div data-testid="text-location">Remote</div></div>
    <div class="cardOutline result" id="b"><h3 class="jobTitle"><span title="Solutions Engineer">Solutions Engineer</span></h3>
      <div data-testid="text-location">Remote</div><div class="salary-snippet-container">$160,000 - $185,000 a year</div></div>
    <div class="cardOutline result" id="c"><h3 class="jobTitle"><span title="Solutions Engineer">Solutions Engineer</span></h3>
      <div data-testid="text-location">Remote</div><div class="salary-snippet-container">$80,000 - $90,000 a year</div></div>`);
  const doc = { location: { hostname: 'www.indeed.com' }, querySelectorAll: (s) => document.querySelectorAll(s) };
  const before = document.querySelectorAll('*').length;
  const cfg = J.DEFAULT_SETTINGS;
  const r = J.scanCards(doc, cfg);
  assert.deepEqual(r, { scanned: 3, dimmed: 2, badged: 0 });
  assert.equal(document.getElementById('a').getAttribute('data-jobscore-skip'), 'Title');
  assert.equal(document.getElementById('b').getAttribute('data-jobscore-skip'), null);
  assert.equal(document.getElementById('c').getAttribute('data-jobscore-skip'), 'Pay');
  assert.equal(document.querySelectorAll('*').length, before, 'no nodes added: it cannot feed the page observer');

  // Loosen pay to a flag: the card is re-judged because the settings are part of its signature.
  const r2 = J.scanCards(doc, J.setPath(cfg, 'gates.pay.onFail', 'flag'));
  assert.equal(r2.dimmed, 1);
  assert.equal(document.getElementById('c').getAttribute('data-jobscore-skip'), null);
  assert.equal(J.scanCards(doc, J.setPath(cfg, 'general.cardPrefilter', false)).scanned, 0);
});

test('policy: a frame on an unlisted host is never a job page, and listed hosts still auto-score', () => {
  assert.equal(J.shouldAutoScore({ host: 'jobs.lever.co', url: 'https://jobs.lever.co/acme/1', body: '' }), true);
  assert.equal(J.shouldAutoScore({ host: 'example.com', url: 'https://example.com/blog', body: 'x'.repeat(100) }), false);
  const off = J.setPath(J.DEFAULT_SETTINGS, 'general.allSites', false);
  J.setCurrentSettings(off);
  assert.equal(J.shouldAutoScore({ host: 'careers.trellix.com', url: 'https://careers.trellix.com/jobs/x', body: '' }), false);
  J.setCurrentSettings(J.DEFAULT_SETTINGS);
  assert.equal(J.shouldAutoScore({ host: 'careers.trellix.com', url: 'https://careers.trellix.com/jobs/x', body: '' }), true);
});

test('result cards you already track are outlined by status, and cards you passed on are dimmed', () => {
  const card = (id, company, title) => '<div class="cardOutline result" id="' + id + '"><h3 class="jobTitle"><span title="' + title + '">' + title + '</span></h3>' +
    '<span data-testid="company-name">' + company + '</span><div data-testid="text-location">Remote</div></div>';
  set(card('a', 'Acme', 'Solutions Engineer') + card('b', 'Borg Inc.', 'Sr Sales Engineer') + card('c', 'Cyber', 'Pre-Sales Engineer') + card('d', 'Dyno', 'Solutions Engineer') + card('e', 'Echo', 'Solutions Engineer'));
  const doc = { location: { hostname: 'www.indeed.com' }, querySelectorAll: (s) => document.querySelectorAll(s) };
  const T = Date.now();
  let jobs = {};
  const add = (id, company, title, verdict, status, extra) => {
    jobs = J.upsertJob(jobs, Object.assign({ id: id, url: 'https://x.com/' + id, company: company, title: title, verdict: verdict }, extra || {}), T).jobs;
    if (status) jobs = J.setStatus(jobs, id, status, T, { followUpDays: 7 });
  };
  add('1', 'Acme', 'Solutions Engineer', 'APPLY');                                      // to apply
  add('2', 'Borg', 'Senior Sales Engineer', 'APPLY', 'applied');                       // applied, listed under another name
  add('3', 'Cyber', 'Pre-Sales Engineer', 'SKIP', null, { fail_gate: 'Pay' });          // skipped by the verdict
  add('4', 'Dyno', 'Solutions Engineer', 'REVIEW');                                    // needs a look
  const idx = J.buildIndex(jobs);
  const lookup = (c, t) => { const k = J.dupKeyFor(c, t); return k ? idx.get(k) || null : null; };
  const before = document.querySelectorAll('*').length;
  const cfg = J.setPath(J.DEFAULT_SETTINGS, 'general.cardPrefilter', false);
  const r = J.scanCards(doc, cfg, lookup);
  assert.deepEqual(r, { scanned: 5, dimmed: 1, badged: 4 }, 'the badges work even with the cheap-gate prefilter off');
  const el = (id) => document.getElementById(id);
  assert.match(el('a').style.outline, /2px solid/);
  assert.equal(el('a').getAttribute('data-jobscore-job'), 'to_apply');
  assert.match(el('b').getAttribute('title'), /Applied/);
  assert.equal(el('b').getAttribute('data-jobscore-job'), 'applied', 'matched across a different company suffix and title wording');
  assert.equal(el('c').style.opacity, '0.35');
  assert.match(el('c').getAttribute('title'), /Passed \(Pay\)/);
  assert.equal(el('d').getAttribute('data-jobscore-job'), 'new');
  assert.equal(el('e').getAttribute('data-jobscore-job'), null, 'an untracked card is left alone');
  assert.equal(document.querySelectorAll('*').length, before, 'no nodes added');

  // status changes are picked up; removing a job clears its card
  jobs = J.setStatus(jobs, '1', 'applied', T, { followUpDays: 7 });
  const idx2 = J.buildIndex(jobs);
  J.scanCards(doc, cfg, (c, t) => { const k = J.dupKeyFor(c, t); return k ? idx2.get(k) || null : null; });
  assert.equal(el('a').getAttribute('data-jobscore-job'), 'applied');
  J.scanCards(doc, cfg, (c, t) => (J.dupKeyFor(c, t) === J.dupKeyFor('Acme', 'Solutions Engineer') ? null : lookup(c, t)));
  assert.equal(el('a').getAttribute('data-jobscore-job'), null);
  assert.equal(el('a').style.outline, '');
  assert.equal(el('a').getAttribute('title'), null);

  // both features off puts everything back
  J.scanCards(doc, cfg, null);
  assert.equal(document.querySelectorAll('[data-jobscore-sig]').length, 0);
  assert.equal(el('c').style.opacity, '');
});

/* ------------------------------------------------------------------------
   Boards verified against live public postings on 2026-10-15. Each fixture
   keeps the real page's structure (the same classes, data-qa and data-*
   hooks, the same element order) with placeholder text.
   ------------------------------------------------------------------------ */

const ldJson = (o) => `<script type="application/ld+json">${JSON.stringify(Object.assign({ '@context': 'https://schema.org', '@type': 'JobPosting' }, o))}</script>`;

test('Lever: an "Apply for this job" button above the posting does not cut it, and the employer is never the headline', () => {
  set(`
    ${ldJson({ title: 'Solutions Engineer', hiringOrganization: { '@type': 'Organization', name: 'Acme Security' } })}
    <div class="main-header page-full-width section-wrapper"><a class="main-header-logo"><img alt="Acme Security logo"></a></div>
    <div class="content-wrapper posting-page"><div class="content">
      <div class="section page-centered posting-header">
        <div class="posting-headline"><h2>Solutions Engineer</h2>
          <div class="posting-categories">
            <div class="sort-by-time posting-category medium-category-label location">Columbus, Ohio</div>
            <div class="sort-by-team posting-category medium-category-label department">Sales /</div>
            <div class="sort-by-commitment posting-category medium-category-label commitment">Full-time /</div>
            <div class="sort-by-time posting-category medium-category-label workplaceTypes">Remote</div>
          </div></div>
        <div class="postings-btn-wrapper"><a class="postings-btn" href="#apply">Apply for this job</a></div>
      </div>
      <div class="section page-centered" data-qa="job-description">${POSTING}</div>
      <div class="section page-centered"><div class="posting-requirements plain-list" data-qa="posting-requirements">3+ years in pre-sales.</div></div>
      <div class="section page-centered last-section-apply"><a href="#apply">Apply for this job</a></div>
    </div></div>`);
  const page = J.extractPosting(document, win('https://jobs.lever.co/acme/0b7e5a52-1111-4c4c-9999-123456789abc'));
  assert.equal(page.site, 'Lever');
  assert.equal(page.title, 'Solutions Engineer');
  assert.equal(page.company, 'Acme Security', 'from the JobPosting data, not the headline block');
  assert.equal(page.location, 'Columbus, Ohio / Remote', 'the workplace type rides along with the place');
  assert.ok(page.body_length > 1000, 'the top Apply button must not cut the posting');
  assert.match(page.body, /technical discovery/);
  assert.equal(page.selector_used, '.content');
});

test('Ashby: the stable ashby-job-posting hooks, and pay from the left pane reaches the model', () => {
  set(`
    ${ldJson({ title: 'Solutions Engineer', hiringOrganization: { '@type': 'Organization', name: 'Acme Security' },
      jobLocation: { '@type': 'Place', address: { addressLocality: 'Columbus', addressRegion: 'Ohio', addressCountry: 'United States' } } })}
    <div class="_left_5yu8i_421 ashby-job-posting-left-pane">
      <div class="_section_f7cvd_36"><h2>Location</h2><p>Columbus, OH</p></div>
      <div class="_section_f7cvd_36"><h2>Location Type</h2><p>Remote</p></div>
      <div class="_section_f7cvd_36"><h2>Compensation</h2><ul class="_compensationTierList_5yu8i_308"><li>$140K \u2013 $160K \u2022 Offers Equity</li></ul></div>
    </div>
    <div class="ashby-job-posting-header"><h1 class="_title_dea4p_33 ashby-job-posting-heading">Solutions Engineer</h1></div>
    <div class="_description_5yu8i_201 ashby-job-posting-description-container">
      <div class="_descriptionText_5yu8i_201 ashby-job-posting-description">${POSTING.replace('Compensation: base salary $140,000 - $160,000. ', '')}</div>
    </div>`);
  const page = J.extractPosting(document, win('https://jobs.ashbyhq.com/acme/6dd5500a-4bd4-4f57-ba09-7b07acefecf4'));
  assert.equal(page.site, 'Ashby');
  assert.equal(page.selector_used, '.ashby-job-posting-description');
  assert.equal(page.title, 'Solutions Engineer');
  assert.equal(page.company, 'Acme Security');
  assert.match(page.location, /Columbus/);
  assert.match(page.body, /=== JOB DETAILS \(location, type, compensation\) ===/);
  assert.match(page.body, /\$140K \u2013 \$160K/, 'pay that is only in the left pane is still sent');
  assert.match(page.body, /Location Type\s+Remote/);
});

test('Built In: the posting body by id, and remote work and pay from the JobPosting data verify as evidence', () => {
  set(`
    ${ldJson({ title: 'Solutions Engineer', hiringOrganization: { '@type': 'Organization', name: 'Acme Security' },
      jobLocationType: 'TELECOMMUTE',
      baseSalary: { '@type': 'MonetaryAmount', currency: 'USD', value: { '@type': 'QuantitativeValue', minValue: 140000, maxValue: 160000, unitText: 'YEAR' } } })}
    <h1>Solutions Engineer</h1>
    <div class="col-12 col-lg-3"><div class="d-flex gap-md">Remote or Hybrid</div><div class="d-flex">140K-160K Annually</div></div>
    <div id="job-post-body-11691362" class="fs-sm fw-regular mb-md html-parsed-content">${POSTING.replace('Compensation: base salary $140,000 - $160,000. Location: Remote. ', '')}</div>
    <div class="col-12 col-md-4 attribute-section">Similar job at another company 187K-237K Annually</div>`);
  const page = J.extractPosting(document, win('https://builtin.com/job/solutions-engineer/11691362'));
  assert.equal(page.site, 'Built In');
  assert.equal(page.selector_used, '[id^="job-post-body-"]');
  assert.equal(page.company, 'Acme Security');
  assert.doesNotMatch(page.body, /187K/, 'a similar-jobs card never feeds the model another job\u2019s pay');
  const line = J.structuredDataLine(page);
  assert.match(line, /jobLocationType=TELECOMMUTE/);
  assert.match(line, /baseSalary=140000-160000 USD\/YEAR/);
  assert.match(J.buildPrompt(J.DEFAULT_SETTINGS, page).user, /STRUCTURED DATA \(schema\.org JobPosting\): .*TELECOMMUTE/);
  // A quote taken from the structured data must verify, or the fact is dropped.
  const v = J.verifyEvidence({ work_arrangement: 'remote', base_min: 140000 },
    { work_arrangement: 'jobLocationType=TELECOMMUTE', base_min: 'baseSalary=140000-160000 USD/YEAR' }, J.evidenceHaystack(page));
  assert.equal(v.x.work_arrangement, 'remote');
  assert.equal(v.x.base_min, 140000);
});

test('Workday: a location repeated in nested elements is listed once', () => {
  set(`
    <h2 data-automation-id="jobPostingHeader">Solutions Engineer</h2>
    <div data-automation-id="locations"><dl><dd>Remote, United States</dd><dd><span>Remote, United States</span></dd></dl></div>
    <div data-automation-id="jobPostingDescription"><div>${POSTING}</div></div>`);
  const page = J.extractPosting(document, win('https://acme.wd1.myworkdayjobs.com/en-US/External/job/x/Solutions-Engineer_R1'));
  assert.equal(page.location, 'Remote, United States');
});

test('a "not part of this posting" marker only cuts a tail, never the posting after a header button', () => {
  const head = 'Solutions Engineer\nColumbus, Ohio\nApply for this job\n';
  assert.match(J.cleanText(head + POSTING), /technical discovery/, 'an apply button at the top keeps the posting');
  assert.doesNotMatch(J.cleanText(POSTING + '\nSimilar jobs\nAccount Executive at Other Co'), /Other Co/, 'a related-jobs tail is still cut');
});

/* LinkedIn, verified 2026-10-15 against saved signed-in pages. The posting
   section's id carries the job number; the header has no handles, only a shape. */
function linkedinHeaderHtml(opts) {
  const title = opts.titleLink
    ? `<p><a href="https://www.linkedin.com/jobs/view/4479560761/?trackingId=x">Solutions Engineer</a><a href="/jobs/search-results/?currentJobId=4479560761"><span role="img" aria-label="Verified job"></span></a></p>`
    : `<p>Solutions Engineer<a href="https://www.linkedin.com/jobs/view/4479560761/#"><span role="img" aria-label="Verified job"></span></a></p>`;
  return `
    <div>
      <a href="https://www.linkedin.com/company/acme-security/life/"><figure><img alt="Company logo for, Acme Security."></figure></a>
      <p><a href="https://www.linkedin.com/company/acme-security/life/">Acme Security</a></p>
      <button aria-label="More options"></button>
    </div>
    <div>${title}</div>
    <p><span>Columbus, Ohio, United States</span> \u00b7 <span><strong>22 hours ago</strong></span> \u00b7 <span>12 people clicked apply</span></p>
    <div><a href="https://www.linkedin.com/jobs/view/4479560761/"><span>Remote</span></a><a href="https://www.linkedin.com/jobs/view/4479560761/"><span>Full-time</span></a></div>`;
}
const linkedinAboutHtml = `
  <div id="JobDetails_AboutTheJob_4479560761" componentkey="JobDetails_AboutTheJob_4479560761">
    <h2>About the job</h2>
    <p><span data-testid="expandable-text-box">${POSTING.slice(0, POSTING.indexOf('We build', 600))}</span>
      <button data-testid="expandable-text-button" aria-hidden="true">\u2026 more</button></p>
    <div>${POSTING.slice(POSTING.indexOf('We build', 600))}</div>
  </div>`;

test('LinkedIn search page: the open pane gives header, location with workplace type, and the whole folded posting', () => {
  set(`
    <ul>
      <li><a href="/jobs/view/111/">Account Executive</a><a href="/company/other-co/">Other Co</a><p><span>Austin, TX</span> \u00b7 <span>1 week ago</span></p></li>
    </ul>
    <div data-sdui-screen="com.linkedin.sdui.flagshipnav.jobs.SemanticJobDetails"><div>
      ${linkedinHeaderHtml({ titleLink: true })}
      ${linkedinAboutHtml}
    </div></div>`);
  const page = J.extractPosting(document, win('https://www.linkedin.com/jobs/search-results/?currentJobId=4479560761&keywords=se'));
  assert.equal(page.site, 'LinkedIn');
  assert.equal(page.selector_used, '[id^="JobDetails_AboutTheJob_"]');
  assert.equal(page.title, 'Solutions Engineer');
  assert.equal(page.company, 'Acme Security', 'the text link, not the empty logo link and not a results card');
  assert.equal(page.location, 'Columbus, Ohio, United States / Remote');
  assert.equal((page.body.match(/We build firewall and backup software/g) || []).length, 30, 'the text folded behind "... more" is read without a click');
  assert.match(page.body, /We build firewall and backup software/);
  assert.equal(page.pane_stale, false);
  assert.ok(!J.coverageReport(page).blockers.some((b) => b.id === 'collapsed'), 'the fold is styling, not a cut posting');
});

test('LinkedIn single job page: plain-text title, and similar-jobs links below the posting do not hide the header', () => {
  set(`
    <main id="workspace"><section aria-label="Primary content"><div>
      ${linkedinHeaderHtml({ titleLink: false })}
      <div>
        ${linkedinAboutHtml}
        <div id="JobDetails_JobAlertToggle_4479560761"><a href="/jobs/view/999/">Similar job</a><a href="/jobs/view/998/">Another job</a></div>
      </div>
    </div></section></main>`);
  const page = J.extractPosting(document, win('https://www.linkedin.com/jobs/view/4479560761/'));
  assert.equal(page.title, 'Solutions Engineer');
  assert.equal(page.company, 'Acme Security');
  assert.equal(page.location, 'Columbus, Ohio, United States / Remote');
  assert.equal(page.pane_stale, false);
});

test('LinkedIn: a pane still showing the previous job is flagged stale and blocks scoring', () => {
  set(`<div>${linkedinHeaderHtml({ titleLink: true })}${linkedinAboutHtml}</div>`);
  const page = J.extractPosting(document, win('https://www.linkedin.com/jobs/search-results/?currentJobId=5550001111'));
  assert.equal(page.pane_stale, true);
  assert.ok(J.coverageReport(page).blockers.some((b) => b.id === 'pane_stale'));
});

test('the job key is read from Indeed and LinkedIn URLs', () => {
  assert.equal(J.urlJobKey('https://www.indeed.com/jobs?q=se&vjk=abc123'), 'abc123');
  assert.equal(J.urlJobKey('https://www.linkedin.com/jobs/search-results/?currentJobId=4479560761'), '4479560761');
  assert.equal(J.urlJobKey('https://www.linkedin.com/jobs/view/4479560761/'), '4479560761');
  assert.equal(J.urlJobKey('https://www.linkedin.com/jobs/view/senior-solutions-engineer-at-acme-4479560761'), '4479560761');
});

/* Result-card labels, and LinkedIn result cards (verified 2026-10-15 against a
   saved signed-in search page). */
function liCard(id, title, company, place, pay) {
  return `<div componentkey="job-card-component-ref-${id}"><div role="button" componentkey="job-card-component-ref-${id}" id="li${id}">
    <p><span>${title} (Verified job)</span><span aria-hidden="true">${title}</span></p>
    <p>${company}</p><p>${place}</p>
    ${pay ? `<div><span>${pay}</span></div>` : ''}
    <span>Posted 1 week ago</span></div></div>`;
}

test('LinkedIn cards: title without the screen-reader copy, company, place and pay are read', () => {
  set(liCard('101', 'Solutions Engineer', 'Acme Security', 'Ohio, United States (Remote)', '$110K/yr - $125K/yr'));
  const f = J.linkedinCardFields(document.getElementById('li101'));
  assert.deepEqual(f, { title: 'Solutions Engineer', company: 'Acme Security', location: 'Ohio, United States (Remote)', pay: '$110K/yr - $125K/yr' });
  assert.equal(J.cheapPay(f.pay), 125000);
});

test('LinkedIn cards are dimmed and labelled with the reason; a remote card that passes is left alone', () => {
  set(liCard('1', 'Account Executive', 'Big Co', 'United States (Remote)') +
      liCard('2', 'Solutions Engineer', 'Low Pay Inc', 'United States (Remote)', '$60K/yr - $80K/yr') +
      liCard('3', 'Solutions Engineer', 'Onsite Co', 'Seattle, Washington, United States') +
      liCard('4', 'Solutions Engineer', 'Good Co', 'Texas, United States (Remote)'));
  const doc = { location: { hostname: 'www.linkedin.com' }, querySelectorAll: (s) => document.querySelectorAll(s) };
  const before = document.querySelectorAll('*').length;
  const r = J.scanCards(doc, J.DEFAULT_SETTINGS);
  const el = (id) => document.getElementById('li' + id);
  assert.deepEqual(r, { scanned: 4, dimmed: 3, badged: 0 });
  assert.equal(el(1).getAttribute('data-jobscore-label'), 'SKIP: title');
  assert.equal(el(1).getAttribute('data-jobscore-kind'), 'title');
  assert.equal(el(2).getAttribute('data-jobscore-label'), 'SKIP: pay $80K < $110K');
  assert.equal(el(2).getAttribute('data-jobscore-kind'), 'pay');
  assert.equal(el(3).getAttribute('data-jobscore-label'), 'SKIP: location');
  assert.equal(el(4).getAttribute('data-jobscore-label'), null, 'remote with a place beside it is not a fail');
  assert.equal(document.querySelectorAll('*').length, before, 'labels are attributes drawn by CSS: no nodes added');
});

test('a tracked job\'s label shows your own decision, and labels can be switched off', () => {
  set(liCard('7', 'Solutions Engineer', 'Acme', 'United States (Remote)') + liCard('8', 'Account Executive', 'Borg', 'United States (Remote)'));
  const doc = { location: { hostname: 'www.linkedin.com' }, querySelectorAll: (s) => document.querySelectorAll(s) };
  const T = Date.parse('2026-10-12T15:00:00Z');
  let jobs = J.upsertJob({}, { id: 'a', url: 'https://x.com/a', company: 'Acme', title: 'Solutions Engineer', verdict: 'APPLY' }, T).jobs;
  jobs = J.setStatus(jobs, 'a', 'applied', T, { followUpDays: 7 });
  jobs = J.upsertJob(jobs, { id: 'b', url: 'https://x.com/b', company: 'Borg', title: 'Account Executive', verdict: 'SKIP', fail_gate: 'Title' }, T).jobs;
  const idx = J.buildIndex(jobs);
  const lookup = (c, t) => { const k = J.dupKeyFor(c, t); return k ? idx.get(k) || null : null; };
  J.scanCards(doc, J.DEFAULT_SETTINGS, lookup);
  const el = (id) => document.getElementById('li' + id);
  assert.equal(el(7).getAttribute('data-jobscore-label'), 'Applied 10-12');
  assert.equal(el(7).getAttribute('data-jobscore-kind'), 'applied');
  assert.equal(el(8).getAttribute('data-jobscore-label'), 'Passed (Title)', 'your decision wins over the cheap gate');
  assert.equal(el(8).getAttribute('data-jobscore-kind'), 'passed');
  J.scanCards(doc, J.setPath(J.DEFAULT_SETTINGS, 'general.cardLabels', false), lookup);
  assert.equal(el(7).getAttribute('data-jobscore-label'), null);
  assert.equal(el(8).getAttribute('data-jobscore-dim'), '1', 'dimming and outlines still work without labels');
});

test('the card stylesheet fades only the card contents, so the label stays readable', () => {
  assert.match(J.CARD_CSS, /\[data-jobscore-label\]::after\{content:attr\(data-jobscore-label\)/);
  assert.match(J.CARD_CSS, /\[data-jobscore-dim\]>\*\{opacity:\.35\}/);
  assert.doesNotMatch(J.CARD_CSS, /\[data-jobscore-dim\]\{[^}]*opacity/, 'never fade the card itself when the sheet is in use');
  assert.match(J.CARD_CSS, /pointer-events:none/, 'the label never blocks a click');
});
