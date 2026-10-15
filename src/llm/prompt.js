// Prompt construction. Pure.
//
// The model reads the posting and states FACTS, each with a verbatim quote that
// code then checks against the page. It never decides APPLY or SKIP - that is
// score(), reading your settings.
import { LIMITS } from '../core/config.js';
import { DEFAULT_SETTINGS } from '../core/settings.js';
import { wordCount } from '../core/util.js';
import { structuredDataLine } from '../extract/posting.js';

function regionOf(cfg) {
  return (cfg && cfg.home && cfg.home.region) || DEFAULT_SETTINGS.home.region;
}

export function schemaText(cfg) {
  const region = regionOf(cfg);
  return `Return ONE JSON object. Every field is an object of the form
{"value": <value>, "present": <true|false>, "evidence": <short VERBATIM quote copied from the posting text, or null>, "explanation": <one short sentence>}.

  present:     true only when the posting itself states this fact, false when it does not.
               present=false requires value=null and evidence=null.
  evidence:    a VERBATIM quote. This is the field's source text and it is checked in code
               against the posting, so an invented quote is worse than no quote.
  explanation: at most 20 words saying where the value came from, or why it is null.
               It is shown to the reader and is never scored.

Fields:
  title: string
  company: string
  work_arrangement: one of "remote" | "hybrid_work" | "onsite" | "unclear"
  office_location: string or null        // the city / place of the office, only when work_arrangement is hybrid_work or onsite
  eligibility_home: one of "yes" | "no" | "unclear"   // could a candidate who lives in ${region} apply? see the rules
  eligibility_text: string or null       // the posting's own wording about who may apply or where the work is done, e.g. "Remote - US only", "must reside in the Southeast territory"
  location_restriction: string or null   // e.g. "must live in the Chicago or Milwaukee territory", "Remote US", "remote but must live in California"
  location_scope: one of "us_wide" | "us_region" | "named_place" | "non_us" | "unclear"  // us_wide = anywhere in the United States; us_region = a US region/timezone/territory only (e.g. "EST Zone"); named_place = a specific city or metro; non_us = outside the US
  base_min: integer USD/year or null     // base only
  base_max: integer USD/year or null     // base only
  base_source: one of "stated" | "derived_from_ote" | "not_stated"   // how base_min/base_max were obtained
  ote_min: integer USD/year or null      // on-target earnings / total target compensation, if stated
  ote_max: integer USD/year or null
  pay_range_is_job_family_wide: boolean  // true if the posting says the range covers a job family, multiple levels, or multiple locations
  pay_posted: boolean                    // true only if a base pay figure appears in the posting
  role_type: one of "presales" | "implementation_or_professional_services" | "support" | "customer_success_or_account_management" | "technical_account_manager" | "sales_ae_or_quota" | "non_it" | "other"
  quota_carrying: boolean                // true only if THIS role carries a sales quota
  years_required: integer or null
  years_required_kind: one of "customer_facing_technical" | "presales_or_se" | "selling_or_quota" | "general_it" | "none"
  buyer_persona: one of "it_admin" | "msp" | "it_director" | "mixed" | "exec" | "business_user" | "other"
  product_name: string or null
  product_category: string or null
  named_tools: {"value": [string, ...], "evidence": [string, ...]}   // one verbatim quote per tool, same order
  requirements: {"value": [{"text": string, "kind": "required" | "preferred"}, ...], "evidence": [string, ...]}   // see the rules
  travel_percent: integer or null        // the largest travel share the posting states, e.g. "up to 25%" -> 25
  travel_scope: one of "none" | "home_region" | "other_region" | "unspecified"   // none = the posting says no travel; home_region = travel only inside the ${region} area; other_region = travel anywhere else, or to customers across a territory outside it; unspecified = travel is mentioned (or not) with no place
  travel_purpose: one of "customer" | "company" | "both" | "unclear" | null   // customer = visits to customer sites; company = internal events, offsites, conferences, trade shows
  posted_days_ago: integer or null
  employer_type: "direct" | "staffing_or_hidden_client"
  one_line_summary: string               // max 20 words

"non_it" covers HVAC, electrical, manufacturing, and construction "sales engineer" roles.`;
}

export function buildSystemPrompt(cfg) {
  const region = regionOf(cfg);
  return [
    'You extract structured facts from ONE job posting so a deterministic scorer can rate it.',
    '',
    'RULES',
    '- Use ONLY the supplied job posting text. If the page has a related-jobs or recommended section, ignore it.',
    '- work_arrangement describes only where the employee physically works. "Hybrid cloud", "hybrid environment",',
    '  "hybrid infrastructure" and "hybrid identity" are technologies and must NOT be treated as hybrid work.',
    '  Use hybrid_work only if the employee is expected to be in an office part of the week.',
    '  When hybrid_work or onsite, put the office city in office_location.',
    '- base_min and base_max are BASE pay only. Never report OTE, on-target earnings, total compensation,',
    '  or a bonus as base pay. base_source records how you got the number. OTE goes in ote_min / ote_max.',
    '- Do not decide APPLY or SKIP.',
    '- eligibility_home answers one question: could a candidate who lives in ' + region + ' apply for this role?',
    '  "yes" only when the posting says so in words: open to anywhere in the United States ("Remote US", "US-based",',
    '  "work from anywhere in the US"), or it names ' + region + ' (the city or its state), or the area around it, as eligible.',
    '  "no" when the posting limits applicants to other places ("must live in California", a territory made of',
    '  other states, a named metro elsewhere).',
    '  "unclear" when it says Remote but never says who may apply, or when it names a territory or region without',
    '  listing the states ("Southeast", "East Coast", "Central region"). Do NOT guess which states a region contains.',
    '  A city printed beside the word Remote ("Remote in Vista, CA") is where the employer is based, NOT a limit on',
    '  where staff may live, and does not make the answer "yes".',
    '  Copy the wording that decided it into eligibility_text and into evidence.',
    '- If a city or state is named, do not write location_restriction as "Remote US" unless the posting says anywhere in the United States.',
    '- location_scope is where the employer says the work may be performed. Use "us_wide" only when the posting says the role',
    '  may be done anywhere in the United States ("Remote, United States", "United States of America", "US-based",',
    '  "work from anywhere in the US"). Use "us_region" when it names only a US region, timezone, or territory ("EST Zone",',
    '  "West Coast territory"). Use "named_place" when it names a specific city or metro. Use "non_us" for a non-US location.',
    '  A named city beats us_wide and us_region. Copy the exact wording as evidence.',
    '- work_arrangement is "remote" only when the posting says the role is fully remote. Do not infer US-wide from the word Remote alone.',
    '- base_source="stated": the posting states a base figure directly.',
    '- base_source="derived_from_ote": the posting gives an OTE/on-target figure AND a base-versus-commission',
    '  split. Do the arithmetic: base = OTE multiplied by the base share. "$150k-$175k OTE with a 75/25 base to',
    '  commission split" means base_min=112500 and base_max=131250. Put the working in explanation',
    '  ("75% of the $150k-$175k OTE"). Quote the sentence that gave the split as evidence.',
    '- base_source="not_stated": no base figure, and no split to derive one from. An OTE figure on its own',
    '  cannot be converted, so base_min and base_max stay null. Never promote an OTE number into base_min.',
    '- Never guess. If a fact is not stated, set value to null, present to false, and evidence to null.',
    '- travel_scope: "none" only if the posting says no travel. If it mentions travel with no place ("some travel"),',
    '  use "unspecified". Never assume travel is local. travel_purpose says what the travel is FOR when the posting says.',
    '- requirements lists up to 12 of the things a candidate must have or would benefit from having, favouring the ones',
    '  that decide whether someone applies: years of experience, certifications, named products or tools, sales methods',
    '  (MEDDPICC, Salesforce), degrees, languages, clearances. text is a short phrase; evidence is the verbatim line.',
    '  kind is "required" for must-haves and "preferred" for nice-to-haves and "a plus".',
    '- company is the employer, not the job board. If the header does not name it, infer it from the posting',
    '  URL or from how the text refers to the employer ("at Wasabi"), and use that URL fragment or phrase as',
    '  the evidence. A hostname that is an ATS (greenhouse.io, lever.co, workday, ashby, ...) is not the',
    '  employer: on those the employer is the path segment, e.g. /wasabi/jobs/1 is Wasabi.',
    '- Set present to true only when the posting itself states the fact, and false when it does not.',
    '  A field with present=false must have value=null. Do not use present to mean "I am unsure".',
    '- explanation is one sentence of at most 20 words saying where the value came from or why it is',
    '  null. It is shown to the reader and is never scored, so it never needs to hedge.',
    '- This schema only covers facts. Whether the role is worth applying to is decided elsewhere.',
    '- quota_carrying is true only if the role itself carries a sales quota (an AE / quota-bearing seat).',
    '- evidence must be copied character for character from the posting text. Short quotes only.',
    '  Do not paraphrase, tidy up, or translate a quote: if you cannot copy it exactly, set evidence to null.',
    '  A field whose quote cannot be found in the posting is thrown away and scored as null, so an invented',
    '  quote is worse than no quote.',
    '- Return only valid JSON matching the schema. No prose, no markdown, no code fences.',
    '',
    'SCHEMA',
    schemaText(cfg),
  ].join('\n');
}

export function buildUserPrompt(cfg, page) {
  const lines = [];
  lines.push('PAGE URL: ' + (page.url || 'unknown'));
  if (page.tab_title) lines.push('BROWSER TAB TITLE: ' + page.tab_title);
  lines.push('POSTING TITLE (page header): ' + (page.title || 'not found'));
  lines.push('COMPANY (page header): ' + (page.company || 'not found'));
  lines.push('LOCATION LINE (page header): ' + (page.location || 'not found'));
  const structured = structuredDataLine(page);
  if (structured) lines.push(structured);
  if (page.posted_days_ago !== null && page.posted_days_ago !== undefined) {
    lines.push('POSTED-DAYS-AGO HINT (computed from the posting date): ' + page.posted_days_ago);
  }
  lines.push('');
  lines.push('--- POSTING TEXT START ---');
  lines.push(page.body || '');
  lines.push('--- POSTING TEXT END ---');
  return lines.join('\n');
}

// The single entry point for prompt construction. Pure.
export function buildPrompt(cfg, page) {
  return { system: buildSystemPrompt(cfg), user: buildUserPrompt(cfg, page) };
}

/* ----------------------------------------------------------------- fit notes
   A second, small call. It sees ONLY the requirement list the first call
   extracted and your profile - never the posting - so editing your profile
   costs a few hundred tokens, not a re-read. Informational: it never changes
   a verdict. */

export function buildFitPrompt(cfg, requirements) {
  const profile = (cfg && cfg.profile) || DEFAULT_SETTINGS.profile;
  const trimmed = wordCount(profile) > LIMITS.PROMPT_PROFILE_MAX_WORDS * 2
    ? profile.split(/\s+/).slice(0, LIMITS.PROMPT_PROFILE_MAX_WORDS * 2).join(' ')
    : profile;
  const system = [
    'You compare a job posting\'s requirements with ONE candidate\'s profile, honestly and briefly.',
    '',
    'For each numbered requirement answer how well the candidate meets it:',
    '  "yes"     - the profile clearly shows it',
    '  "partial" - adjacent or partly shown (say what is close)',
    '  "no"      - the profile shows a gap, or says the candidate lacks it',
    '  "unknown" - the profile says nothing either way',
    'Judge ONLY from the profile. Never invent experience the profile does not state.',
    'note: at most 15 words, naming the profile fact you relied on.',
    'summary: one sentence of at most 25 words on the biggest gap or strength.',
    '',
    'Return only JSON, no prose, no code fences:',
    '{"items":[{"i":0,"meets":"yes|partial|no|unknown","note":"..."}],"summary":"..."}',
    '',
    'CANDIDATE PROFILE',
    trimmed,
  ].join('\n');
  const user = 'REQUIREMENTS\n' + requirements.map((r, i) => i + '. [' + r.kind + '] ' + r.text).join('\n');
  return { system: system, user: user };
}
