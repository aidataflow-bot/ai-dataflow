// Discovery questionnaire (SOP 001, Stage 3). The consultant asks these in the first client meeting and
// records the answers on the client. Server-side only: the browser gets the questions from the API,
// so there is one source of truth and answers for unknown questions are refused.
//
// Sections 1-8 apply to every client. An industry add-on is shown only when the client's Industry
// matches a key in INDUSTRY_ADDONS (today: real-estate). To add another industry, add an entry there.
//
// star: true = ask in the room (the SOP gives discovery about 20 minutes); the rest wait for a follow-up.
// type: 'text' (free text, up to MAX_ANSWER characters) or 'choice' (one of options).
// Questions marked "figure" ask for numbers; they are typed as text for now and the ROI calculator
// (Phase 3) reads the figures from them.

const MAX_ANSWER = 2000;

const q = (id, text, extra = {}) => ({ id, text, type: 'text', star: false, ...extra });

const SECTIONS = [
  {
    id: 'goals',
    title: 'Business goals and challenges',
    questions: [
      q('goals-business', 'What does the business do, and who are its customers?'),
      q('goals-top3', 'What are your top three goals for the next 12 months?', { star: true }),
      q('goals-blocker', 'What is slowing the business down most today?', { star: true }),
      q('goals-one-problem', 'If one problem disappeared tomorrow, which would it be?'),
      q('goals-numbers', 'Which numbers do you check to know the business is doing well?')
    ]
  },
  {
    id: 'processes',
    title: 'Manual processes and inefficiencies',
    note: 'Questions 2 and 3 feed the ROI calculation, so get a figure even if it is a rough one.',
    questions: [
      q('proc-repeat', 'What tasks repeat every day or every week? Walk me through a typical week.'),
      q('proc-hours', 'For the top three repeated tasks: how many hours per week do they take, and how many people do them?',
        { star: true, figure: true, hint: 'For example: 12 hours a week, 3 people' }),
      q('proc-cost', 'Roughly what does that time cost per hour, including benefits or contractor fees?',
        { star: true, figure: true, hint: 'For example: $35 an hour' }),
      q('proc-errors', 'Where do errors, rework or delays happen, and how often?'),
      q('proc-cracks', 'What tends to fall through the cracks?'),
      q('proc-handoffs', 'Which handoffs between people or tools are slowest?')
    ]
  },
  {
    id: 'tech',
    title: 'Existing software and technology',
    questions: [
      q('tech-tools', 'Which tools does the team use every day (CRM, email, calendar, spreadsheets, accounting, messaging)?', { star: true }),
      q('tech-paid', 'Which of them do you pay for, and about how much per month?', { figure: true }),
      q('tech-avoid', 'Which tools do people avoid or work around?'),
      q('tech-owner', 'Who looks after the tools: an employee, a vendor or nobody?',
        { type: 'choice', options: ['An employee', 'A vendor', 'Nobody'] })
    ]
  },
  {
    id: 'ai',
    title: 'Current AI adoption',
    questions: [
      q('ai-use', 'Does anyone already use AI tools (ChatGPT, Claude, Copilot, built-in features), and for what?', { star: true }),
      q('ai-history', 'Has the business tried automation or AI before? What worked and what did not?'),
      q('ai-worries', 'What worries you about using AI: accuracy, client trust, staff pushback?')
    ]
  },
  {
    id: 'automation',
    title: 'Automation opportunities',
    note: 'None of these are starred: the consultant forms this picture from sections 1-4 and uses these questions to test it.',
    questions: [
      q('auto-rules', 'Which tasks follow the same rules every time?'),
      q('auto-judgment', 'Which tasks need an expert\'s judgment, and which only move information between places?'),
      q('auto-first', 'If one task were automated tomorrow, which would you pick first?'),
      q('auto-speed', 'Where does speed matter most, such as replying to a customer within minutes?')
    ]
  },
  {
    id: 'data',
    title: 'Data and system integrations',
    questions: [
      q('data-where', 'Where does the key data live: CRM, spreadsheets, email, paper?', { star: true }),
      q('data-quality', 'How clean and complete is it?',
        { type: 'choice', options: ['Clean', 'Mostly clean', 'Messy'] }),
      q('data-connect', 'Can the main tools export data or connect to other tools (built-in integrations, Zapier, an API)?'),
      q('data-admin', 'Who has admin access to the main tools?')
    ]
  },
  {
    id: 'security',
    title: 'Security and compliance',
    questions: [
      q('sec-data', 'What sensitive data does the business handle (IDs, financial details, contracts)?'),
      q('sec-rules', 'Are there legal, regulatory or contract rules on storing or sharing it?'),
      q('sec-ai', 'May client data be processed by third-party AI tools?',
        { star: true, type: 'choice', options: ['Yes', 'Yes, with limits', 'No'] }),
      q('sec-approver', 'Who approves new tools or vendors?')
    ]
  },
  {
    id: 'budget',
    title: 'Budget, timeline and decision-makers',
    note: 'Ask, never quote: SOP 001 allows no pricing or delivery commitment before internal evaluation.',
    questions: [
      q('bud-budget', 'What budget have you set aside for this?', { star: true, figure: true }),
      q('bud-when', 'When do you want to see results?',
        { star: true, type: 'choice', options: ['Within 1 month', '1-3 months', '3-6 months', 'More than 6 months', 'No fixed date'] }),
      q('bud-decider', 'Who makes the final decision, and who else must approve?', { star: true }),
      q('bud-success', 'What would make this a clear success a year from now?')
    ]
  }
];

const INDUSTRY_ADDONS = {
  'real-estate': {
    id: 'addon-real-estate',
    title: 'Industry add-on: Real Estate',
    note: 'Shown only for Real Estate clients. Headcount is captured by Sales when the client is created.',
    questions: [
      q('re-leads', 'How many new leads arrive each month, and from which sources?', { star: true, figure: true }),
      q('re-reply', 'How fast does a new lead get a first reply today, and who sends it?', { star: true, figure: true, hint: 'For example: about 2 hours, the assigned agent' }),
      q('re-crm', 'Which CRM do you use (for example Lofty), and how consistently do agents log activity in it?', { star: true }),
      q('re-followup', 'What happens to leads that do not convert right away: is there a follow-up routine?'),
      q('re-showings', 'How are showings scheduled and confirmed?'),
      q('re-closings', 'How many closings a month, and what is the average commission per closing?', { star: true, figure: true }),
      q('re-paperwork', 'What paperwork does each transaction need (contracts, disclosures, checklists), who handles it, and how many hours per closing?', { star: true, figure: true }),
      q('re-listings', 'How are listings marketed (photos, descriptions, social posts), who does it, and how long per listing?'),
      q('re-onboarding', 'How are new agents onboarded and trained?'),
      q('re-reporting', 'How are monthly commissions, reports and broker reviews prepared, and how many hours does it take?', { figure: true })
    ]
  }
};

// The sections that apply to a client of this industry: the eight universal ones, then the add-on if any.
function sectionsFor(industry) {
  const addon = INDUSTRY_ADDONS[String(industry || '')];
  return addon ? [...SECTIONS, addon] : SECTIONS;
}

function allQuestions(industry) {
  return sectionsFor(industry).flatMap(section => section.questions.map(question => ({ ...question, sectionId: section.id, sectionTitle: section.title })));
}

// What the browser gets: no server-only fields.
function publicSections(industry) {
  return sectionsFor(industry).map(section => ({
    id: section.id,
    title: section.title,
    note: section.note || '',
    questions: section.questions.map(question => ({
      id: question.id,
      text: question.text,
      type: question.type,
      star: question.star,
      figure: Boolean(question.figure),
      hint: question.hint || '',
      options: question.options || []
    }))
  }));
}

// Validates a set of changes and returns the new full answer map plus how many answers changed.
// `changes` maps question id -> string; an empty string clears the answer. Throws a 400 for
// unknown questions, options that are not on the list, or answers that are too long.
function applyAnswerChanges(industry, existing, changes) {
  const known = new Map(allQuestions(industry).map(question => [question.id, question]));
  const next = { ...(existing || {}) };
  let changed = 0;
  if (!changes || typeof changes !== 'object' || Array.isArray(changes)) {
    throw Object.assign(new Error('Send the answers as an object of question id to answer'), { status: 400 });
  }
  for (const [questionId, raw] of Object.entries(changes)) {
    const question = known.get(questionId);
    if (!question) {
      throw Object.assign(new Error('Unknown question: ' + String(questionId).slice(0, 60)), { status: 400 });
    }
    const value = String(raw == null ? '' : raw).trim();
    if (value.length > MAX_ANSWER) {
      throw Object.assign(new Error(`An answer can be at most ${MAX_ANSWER} characters`), { status: 400 });
    }
    if (value && question.type === 'choice' && !question.options.includes(value)) {
      throw Object.assign(new Error('Pick one of the listed options'), { status: 400 });
    }
    if ((next[questionId] || '') === value) continue;
    if (value) next[questionId] = value;
    else delete next[questionId];
    changed++;
  }
  return { answers: next, changed };
}

// Answered questions in catalog order, for the AI prompt and the report snapshot.
function answeredList(industry, answers) {
  const stored = answers || {};
  return allQuestions(industry)
    .filter(question => String(stored[question.id] || '').trim())
    .map(question => ({
      section: question.sectionTitle,
      question: question.text,
      answer: String(stored[question.id]).trim(),
      star: question.star
    }));
}

function progress(industry, answers) {
  const stored = answers || {};
  const questions = allQuestions(industry);
  const starred = questions.filter(question => question.star);
  const has = question => Boolean(String(stored[question.id] || '').trim());
  return {
    answered: questions.filter(has).length,
    total: questions.length,
    starredAnswered: starred.filter(has).length,
    starredTotal: starred.length
  };
}

module.exports = { MAX_ANSWER, sectionsFor, publicSections, applyAnswerChanges, answeredList, progress };
