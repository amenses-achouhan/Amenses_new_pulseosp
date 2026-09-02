/*
 * Ticket 1 — Webhook normalization tests (T1-01 … T1-09).
 *
 * Console-script pattern (no jest): run with `node server/src/services/normalizers/normalizers.test.js`.
 */
const { normalizeGithub } = require('./github');
const { normalizeSlack } = require('./slack');
const { normalizeJira } = require('./jira');
const { prOpened, prMerged, prClosed, push, ping } = require('../../../test/fixtures/github');
const { message, fileShare, urlVerification } = require('../../../test/fixtures/slack');
const { issueCreated, issueUpdated } = require('../../../test/fixtures/jira');

let passed = 0;
let failed = 0;
function check(name, cond, detail = '') {
  if (cond) { passed++; console.log(`✅ ${name}`); }
  else { failed++; console.log(`❌ ${name}${detail ? ` — ${detail}` : ''}`); }
}

async function runTests() {
  console.log('🧪 Running Ticket 1 — Normalizer tests...\n');

  // T1-01 GitHub PR opened
  const ghOpened = normalizeGithub(prOpened, 'org1');
  check('T1-01 GitHub PR opened -> source=github, type=pr_opened', ghOpened.source === 'github' && ghOpened.type === 'pr_opened', JSON.stringify(ghOpened));
  check('T1-01 actor from sender.login', ghOpened.actor === 'priya', ghOpened.actor);

  // T1-02 GitHub PR merged
  const ghMerged = normalizeGithub(prMerged, 'org1');
  check('T1-02 GitHub PR merged -> type=pr_merged', ghMerged.type === 'pr_merged', ghMerged.type);

  // T1-02b GitHub PR closed (not merged) -> pr_closed
  const ghClosed = normalizeGithub(prClosed, 'org1');
  check('T1-02 GitHub PR closed -> type=pr_closed', ghClosed.type === 'pr_closed', ghClosed.type);

  // T1-03 GitHub push
  const ghPush = normalizeGithub(push, 'org1');
  check('T1-03 GitHub push -> type=push', ghPush.type === 'push', ghPush.type);

  // T1-04 Slack message
  const slMsg = normalizeSlack(message, 'org1');
  check('T1-04 Slack message -> source=slack, type=message', slMsg.source === 'slack' && slMsg.type === 'message', JSON.stringify(slMsg));

  // T1-05 Slack file share
  const slFile = normalizeSlack(fileShare, 'org1');
  check('T1-05 Slack file share -> type=file_share', slFile.type === 'file_share', slFile.type);

  // Slack URL verification (keeps challenge for the route to echo)
  const slUrl = normalizeSlack(urlVerification, 'org1');
  check('Slack url_verification -> challenge preserved + type', slUrl.type === 'url_verification' && slUrl.metadata.challenge === urlVerification.challenge, JSON.stringify(slUrl));

  // T1-06 Jira issue created
  const jrCreated = normalizeJira(issueCreated, 'org1');
  check('T1-06 Jira issue created -> source=jira, type=issue_created', jrCreated.source === 'jira' && jrCreated.type === 'issue_created', JSON.stringify(jrCreated));

  // T1-07 Jira issue updated
  const jrUpdated = normalizeJira(issueUpdated, 'org1');
  check('T1-07 Jira issue updated -> type=issue_updated', jrUpdated.type === 'issue_updated', jrUpdated.type);

  // T1-08 Invalid payload — orange: normalizer is defensive, returns 'unknown' type rather than throwing.
  let malformed;
  try {
    malformed = normalizeGithub(null, 'org1');
    check('T1-08 null payload handled without throwing', !!malformed && malformed.type === 'unknown', JSON.stringify(malformed));
  } catch (e) {
    check('T1-08 null payload handled without throwing', false, e.message);
  }

  // T1-09 Missing organizationId — routes enforce this; normalizer must preserve undefined honestly.
  const noOrg = normalizeGithub(prOpened, undefined);
  check('T1-09 missing organizationId propagates undefined (route guards it)', noOrg.organizationId === undefined, String(noOrg.organizationId));

  // Uniform shape checks
  const all = [ghOpened, ghPush, slMsg, slFile, jrCreated];
  const shapeOk = all.every((a) =>
    a && typeof a.source === 'string' && typeof a.type === 'string' &&
    typeof a.actor === 'string' && (a.timestamp instanceof Date) &&
    a.metadata && typeof a.metadata === 'object'
  );
  check('Shape: all activities carry source/type/actor/timestamp/metadata', shapeOk);

  // Ping event robustness
  const ghPing = normalizeGithub(ping, 'org1');
  check('GitHub ping -> type=ping', ghPing.type === 'ping', ghPing.type);

  console.log(`\n📊 ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch((e) => { console.error('Harness crashed', e); process.exit(1); });