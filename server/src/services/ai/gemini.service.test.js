/*
 * Ticket 5 — gemini.service tests (T5-01 … T5-06).
 *
 * Console-script pattern. Mocks `@google/generative-ai` (and its model) so the
 * prompt -> JSON parse -> Joi validation -> retry pipeline is exercised with no
 * network and no GEMINI_API_KEY.
 *
 * Run: node server/src/services/ai/gemini.service.test.js
 */
const path = require('path');

let passed = 0;
let failed = 0;
function check(name, cond, detail = '') {
  if (cond) { passed++; console.log(`✅ ${name}`); }
  else { failed++; console.log(`❌ ${name}${detail ? ` — ${detail}` : ''}`); }
}

// ---------------------------------------------------------------------------
// Mockable fake Gemini
// ---------------------------------------------------------------------------
let scriptedResponses = []; // FIFO of results for successive generateContent calls
let callCount = 0;

class FakeModel {
  async generateContent() {
    callCount++;
    const next = scriptedResponses.shift();
    if (!next) throw new Error('No scripted response');
    return { response: { text: () => next } };
  }
}

class FakeGoogleGenerativeAI {
  constructor(apiKey) { this.apiKey = apiKey; }
  getGenerativeModel() { return new FakeModel(); }
}

function installMock(rel, fake) {
  // Bare package names (e.g. '@google/generative-ai') resolve via node_modules;
  // relative paths resolve against this test file.
  const file = rel.startsWith('.')
    ? require.resolve(path.join(__dirname, rel))
    : require.resolve(rel);
  require.cache[file] = { id: file, filename: file, loaded: true, exports: fake };
}

const VALID_SUMMARY = {
  summary: 'Team shipped 8 merged PRs and closed 5 tickets; velocity steady.',
  key_metrics: {
    prs_merged: 8,
    prs_opened: 12,
    active_developers: 5,
    jira_issues_completed: 5,
    jira_issues_created: 7,
    slack_messages: 42,
  },
  top_contributors: ['Priya Shah', 'Daniel Kim'],
  risks: ['Review turnaround up 40% on payments-api'],
  recommendations: ['Address review bottleneck on payments-api'],
};

async function runTests() {
  // Mock must be installed BEFORE requiring gemini.service.
  installMock('@google/generative-ai', { GoogleGenerativeAI: FakeGoogleGenerativeAI });
  const { geminiService } = require('./gemini.service');
  const CONTEXT = '## Engineering Activity Context\nPeriod: Aug 18 - Aug 24\n';

  console.log('🧪 Running Ticket 5 — gemini.service tests...\n');

  // T5-01 valid context -> valid AISummary object
  scriptedResponses = [JSON.stringify(VALID_SUMMARY)];
  let summary = await geminiService.generateSummary(CONTEXT, 'weekly');
  check('T5-01 valid context -> valid summary object', !!summary && typeof summary.summary === 'string', JSON.stringify(summary));
  check('T5-01 key_metrics present + numeric', summary.key_metrics && typeof summary.key_metrics.prs_merged === 'number' && Number.isInteger(summary.key_metrics.prs_merged));

  // T5-03 minimal context (1 activity string) still succeeds
  scriptedResponses = [JSON.stringify({ ...VALID_SUMMARY, summary: 'Single activity week produced a healthy report.' })];
  summary = await geminiService.generateSummary('One commit by priya.', 'weekly');
  check('T5-03 minimal context still generates', !!summary && summary.summary.length >= 10);

  // T5-04 invalid Gemini key / transport error surfaces after retries
  scriptedResponses = []; // every call throws "No scripted response"
  let err = null;
  try { await geminiService.generateSummary(CONTEXT, 'weekly'); } catch (e) { err = e; }
  check('T5-04 persistent failure throws', !!err, String(err && err.message));

  // T5-06 non-JSON output is rejected (parsed as invalid), then error thrown
  scriptedResponses = ['this is not json'];
  err = null;
  try { await geminiService.generateSummary(CONTEXT, 'weekly'); } catch (e) { err = e; }
  check('T5-06 non-JSON output rejected', !!err, String(err && err.message));

  // Schema conformance: missing required field fails validation
  const missingMetrics = JSON.stringify({ ...VALID_SUMMARY, key_metrics: undefined });
  scriptedResponses = [missingMetrics];
  err = null;
  try { await geminiService.generateSummary(CONTEXT, 'weekly'); } catch (e) { err = e; }
  check('Schema: missing key_metrics rejected by validation', !!err, String(err && err.message));

  // Retry: first attempt invalid, second valid -> succeeds
  callCount = 0;
  scriptedResponses = [
    JSON.stringify({ ...VALID_SUMMARY, key_metrics: undefined }), // invalid
    JSON.stringify(VALID_SUMMARY),                                // valid
  ];
  summary = await geminiService.generateSummary(CONTEXT, 'weekly');
  check('Retry: invalid then valid -> succeeds on retry', !!summary && summary.key_metrics.prs_merged === 8);
  check('Retry made exactly 2 calls', callCount === 2, String(callCount));

  // Numeric coercion: string numbers are normalized to integers upstream
  const stringy = JSON.parse(JSON.stringify(VALID_SUMMARY));
  stringy.key_metrics.prs_merged = '8';
  scriptedResponses = [JSON.stringify(stringy)];
  summary = await geminiService.generateSummary(CONTEXT, 'weekly');
  check('Numeric coercion: "8" -> integer 8', summary.key_metrics.prs_merged === 8 && Number.isInteger(summary.key_metrics.prs_merged));

  console.log(`\n📊 ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch((e) => { console.error('Harness crashed:', e); process.exit(1); });