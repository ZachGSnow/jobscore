import { esc, log, str } from '../core/util.js';
import { indeedHeader } from './indeed.js';
import { linkedinHeader } from './linkedin.js';

export const SITE_SELECTORS = [
  {
    // CONFIRMED 2026-10-15 against saved signed-in pages: the two-pane
    // /jobs/search-results/ page and a single /jobs/view/ page. Classes are
    // hashed, so the handles are the posting section's id, which carries the
    // job number (JobDetails_AboutTheJob_<id>), and the header's shape, read by
    // linkedinHeader(). The section holds the WHOLE posting even while it is
    // folded behind "... more" (the fold is styling), so no click is needed.
    // The job number is compared with the URL (currentJobId or /jobs/view/<id>)
    // so a pane still showing the previous job is never scored.
    match: /(^|\.)linkedin\.com$/i,
    name: 'LinkedIn',
    // paneFromDescription: the header is read inside the ancestor of the
    // posting that also holds the job link, so the left-hand results list can
    // never supply the title.
    paneFromDescription: true,
    header: linkedinHeader,
    description: [
      '[id^="JobDetails_AboutTheJob_"]',
      '[data-testid="expandable-text-box"]',
    ],
    company: ['p a[href*="/company/"]'],
  },
  {
    // CONFIRMED against job-boards.greenhouse.io/wasabi/jobs/5392451008: the
    // board wraps the posting in .job__title (an h1.section-header), a
    // .job__location sibling that holds an SVG pin icon plus the place, and
    // the body in .job__description. The older app-title / #app_body classes
    // are kept as fallbacks for boards still on the pre-job-boards layout.
    match: /(^|\.)greenhouse\.io$/i,
    name: 'Greenhouse',
    description: ['.job__description', '#content', '#app_body', '.job-post'],
    title: ['.job__title h1', 'h1.section-header', 'h1.app-title', '.app-title', 'h1'],
    // Greenhouse renders NO employer name in the posting header, so these only
    // fire on the rarer board-header layout. Otherwise companyFromUrl reads it
    // from the path (/wasabi/jobs/1 -> Wasabi), and company_source reports 'url'.
    company: ['.company-name', '#header .company-name', '.job__company', '[class*="companyName"]', '[data-testid="company-name"]', '#wrapper .company-name'],
    location: ['.job__location', '.location', '.job-post__location', '#header .location', '[class*="job__location"]'],
  },
  {
    // CONFIRMED against arcticwolf.wd1.myworkdayjobs.com: the description is
    // [data-automation-id="jobPostingDescription"], the title is an h2
    // [data-automation-id="jobPostingHeader"], and the header block is a <dl>
    // whose <dd>s list every location the requisition covers. Note the page
    // hydrates in pieces - the description can arrive after the header - so an
    // empty body is a retry, not a verdict.
    match: /(^|\.)myworkdayjobs\.com$/i,
    name: 'Workday',
    description: [
      '[data-automation-id="jobPostingDescription"]',
      '[data-automation-id="jobPostingDescription"] > div',
      '[class*="jobPostingDescription"]',
      '#jobPostingDescription',
    ],
    title: [
      'h1[data-automation-id="jobPostingHeader"]',
      'h2[data-automation-id="jobPostingHeader"]',
      '[data-automation-id="jobPostingHeader"]',
      'h1',
    ],
    company: ['[data-automation-id="companyName"]', '[data-automation-id="company"]', '[data-automation-id="hiringOrganization"]'],
    // Every <dd>, joined: "locations" is the field label, not a location, and
    // taking only the first line would drop "Remote - USA - Ohio".
    locationAll: ['[data-automation-id="locations"] dd', '[data-automation-id="jobPostingLocation"] dd'],
    location: ['[data-automation-id="locations"]', '[data-automation-id="location"]', '[data-automation-id="jobPostingLocation"]'],
  },
  {
    // CONFIRMED against the two-pane search page Indeed alerts open (a
    // saved copy of it). The left list holds the result cards; the open job
    // lives in the right pane, [data-testid="viewjob-main-content"], which
    // is where EVERYTHING is read from. Reading the whole page would mix in
    // the other cards' titles, salaries and "Remote" tags.
    //
    // Inside the pane: the title is data-testid="vj-job-title"; the company
    // is the /cmp/ link in data-testid="company-info-metadata"; the location
    // is bare divs in that same block ("Vista, CA", "\u2022", "Remote") with
    // no testid, read by indeedHeader(); PAY lives in
    // data-testid="structured-job-summary" ("Job details"), OUTSIDE the
    // description, so it is sent as its own labelled block; and the body is
    // .simple-job-description-html. Indeed's own classes are hashed
    // (css-146c3p1, r-1xnzce8) and rotate, so they are never handles.
    //
    // window._initialData is deliberately NOT used: it describes only the
    // job auto-opened at page load, so after you click another card it would
    // quietly score the wrong posting.
    //
    // strict: no page-wide fallback and no h1 / tab-title fallback. On a
    // search page the h1 is "... jobs in Remote", which would be scored as
    // this job's title. A missing field is "not captured", never guessed.
    match: /(^|\.)indeed\.com$/i,
    name: 'Indeed',
    strict: true,
    cards: true,
    paneRoot: ['[data-testid="viewjob-main-content"]', '#jobsearch-ViewjobPaneWrapper'],
    header: indeedHeader,
    blocks: [
      { label: 'JOB DETAILS (pay, job type, location)', selector: '[data-testid="structured-job-summary"]', pay: true },
    ],
    description: [
      '.simple-job-description-html',
      '.react-native-html-content',
      '#jobDescriptionText',
      '.jobsearch-JobComponent-description',
    ],
    title: ['[data-testid="vj-job-title"]', '.jobsearch-JobInfoHeader-title'],
    company: ['[data-testid="company-info-metadata"] a[href*="/cmp/"]', '[data-testid="inlineHeader-companyName"]', '.jobsearch-CompanyInfoContainer a', '[data-company-name="true"]'],
    location: ['[data-testid="inlineHeader-companyLocation"]', '.jobsearch-JobInfoHeader-companyLocation', '#jobLocationText'],
  },
  {
    // Built In renders the posting as <div id="job-post-body-<jobId>"
    // class="... html-parsed-content">, next to a "Summary Generated by Built In"
    // blurb and a "Read Full Description" toggle. The id carries the job number,
    // hence the ^= match.
    match: /(^|\.)builtin\.com$/i,
    name: 'Built In',
    description: [
      '[id^="job-post-body-"]',
      '.html-parsed-content',
      '#job-description',
      '.job-description',
      '[data-id="job-description"]',
      '.job-post-body',
    ],
    title: ['h1', '.job-header h1'],
    company: ['.company-title', '[data-id="company-title"]'],
    location: ['.job-location', '[data-id="job-location"]'],
  },
  {
    // CONFIRMED against jobs.lever.co/palantir (2026-10-15): .content holds the
    // whole posting, its sections carry data-qa hooks (job-description,
    // posting-requirements, closing-description), and the title is the h2 in
    // .posting-headline. .posting-categories holds .location and .workplaceTypes
    // (Remote / Hybrid / On-site), joined so the location gate sees both.
    // The employer is only a logo image here; it comes from the page's
    // JobPosting ld+json (hiringOrganization), so there is no company selector:
    // the old .posting-headline fallback returned the title and location.
    match: /(^|\.)lever\.co$/i,
    name: 'Lever',
    description: ['.content', '.posting-page', '[data-qa="job-description"]'],
    title: ['.posting-headline h2'],
    locationAll: ['.posting-categories .location, .posting-categories .workplaceTypes'],
    location: ['.posting-categories .location'],
  },
  {
    // CONFIRMED against jobs.ashbyhq.com/openai (2026-10-15). Ashby's CSS
    // classes are hashed (_descriptionText_5yu8i_201), but it also ships stable
    // ashby-job-posting-* hooks for custom styling, which are what is used.
    // The employer and location come from the JobPosting ld+json. Pay is in
    // the left pane ("$230K - $385K") and often NOT in the description, so the
    // pane is sent as its own labelled block.
    match: /(^|\.)ashbyhq\.com$/i,
    name: 'Ashby',
    description: ['.ashby-job-posting-description', '.ashby-job-posting-description-container'],
    title: ['.ashby-job-posting-heading', 'h1'],
    blocks: [
      { label: 'JOB DETAILS (location, type, compensation)', selector: '.ashby-job-posting-left-pane', pay: true },
    ],
  },
];

export function siteFor(hostname) {
  return SITE_SELECTORS.find((s) => s.match.test(hostname)) || null;
}
