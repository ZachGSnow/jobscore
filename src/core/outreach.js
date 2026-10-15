// A first message to someone at the company, written from facts and nothing
// else. No model call: every line comes from the job record, your settings, or a
// fit note the model already marked as a match, so it cannot claim experience you
// do not have. Pure, so it is unit-tested.
import { productMatch } from './gates.js';
import { DEFAULT_SETTINGS } from './settings.js';
import { clip } from './util.js';

export const RECIPIENTS = [
  { id: 'manager', label: 'Hiring manager' },
  { id: 'peer', label: 'Someone on the team' },
  { id: 'recruiter', label: 'Recruiter' },
];

// "Sr. Solutions Architect - EST Zone" -> "Sr. Solutions Architect"
export function cleanTitle(title) {
  return String(title || '')
    .replace(/\(.*?\)/g, ' ')
    .replace(/\s*[,|]\s+.*$/, '')
    .replace(/\s[-\u2013\u2014]\s.*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// "Wasabi Technologies, Inc." -> "Wasabi"
export function shortCompany(company) {
  return String(company || '')
    .replace(/[,.]/g, ' ')
    .replace(/\b(inc|incorporated|llc|ltd|limited|corp|corporation|technologies|technology|co|company)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function firstName(name) {
  const w = String(name || '').trim().split(/\s+/)[0] || '';
  return w ? w.charAt(0).toUpperCase() + w.slice(1) : '';
}

function sentence(text) {
  const t = String(text || '').trim().replace(/[.\s]+$/, '');
  return t ? t.charAt(0).toUpperCase() + t.slice(1) + '.' : '';
}

// The one thing worth saying that is certainly true: a product you listed as
// familiar, matched against the company and the posting's product.
function knownProduct(job, settings) {
  return productMatch({ product_name: job.product || '', named_tools: [job.company] }, settings);
}

const ASK = {
  manager: {
    long: "If you're open to it, I'd value ten minutes to hear what you're looking for in this seat.",
    note: 'Open to a quick chat about the seat?',
  },
  peer: {
    long: 'Would you be open to sharing what the team is like and what makes someone successful in this role?',
    note: 'Could I ask you a couple of questions about the team?',
  },
  recruiter: {
    long: 'I wanted to make sure my application reached you.',
    note: 'Wanted to make sure it reached you.',
  },
};

// opts: { type: 'manager'|'peer'|'recruiter', mode: 'note'|'message', name }
// ctx:  { job, settings }
export function buildOutreach(opts, ctx) {
  const s = (ctx && ctx.settings) || DEFAULT_SETTINGS;
  const o = Object.assign({}, DEFAULT_SETTINGS.outreach, s.outreach);
  const job = (ctx && ctx.job) || {};
  const type = ASK[opts && opts.type] ? opts.type : 'manager';
  const mode = opts && opts.mode === 'note' ? 'note' : 'message';
  const name = firstName(opts && opts.name);
  const company = shortCompany(job.company) || 'your company';
  const role = cleanTitle(job.title) || 'open';
  const known = knownProduct(job, s);
  const strengths = (job.strengths || []).map((t) => String(t).trim()).filter(Boolean).slice(0, 2);
  const question = (job.questions || [])[0];
  const me = sentence(o.intro);
  const greet = name ? 'Hi ' + name + ',' : 'Hi,';

  if (mode === 'note') {
    const limit = Math.max(60, Number(o.noteLimit) || 200);
    const roleLine = 'I applied for the ' + role + ' role at ' + company + '.';
    const hook = known ? "I've used " + known + ' hands-on.' : '';
    const ask = ASK[type].note;
    // Drop the least important piece until it fits.
    const tries = [
      [greet, roleLine, me, hook, ask],
      [greet, roleLine, hook, ask],
      [greet, roleLine, me, ask],
      [greet, roleLine, ask],
      ['Hi,', roleLine, ask],
      ['Hi,', roleLine],
    ];
    let text = '';
    for (const parts of tries) {
      text = parts.filter(Boolean).join(' ');
      if (text.length <= limit) return { text: text, length: text.length, limit: limit, mode: mode };
    }
    text = clip(text, limit);
    return { text: text, length: text.length, limit: limit, mode: mode };
  }

  const background = [];
  if (known) background.push('I have hands-on experience with ' + known + '.');
  if (strengths.length) background.push('Relevant background: ' + strengths.join('; ').replace(/[.\s]+$/, '') + '.');
  let ask = ASK[type].long;
  if (type === 'recruiter') ask += question ? ' One quick question: ' + String(question).replace(/\s+/g, ' ').trim() : ' Happy to answer anything you need.';

  const body = ['I just applied for the ' + role + ' role at ' + company + '. ' + [me].concat(background).filter(Boolean).join(' '), ask];
  const text = [greet, body[0].trim(), body[1], o.name ? 'Thanks,\n' + o.name : 'Thanks!'].join('\n\n');
  return { text: text, length: text.length, limit: null, mode: mode };
}
