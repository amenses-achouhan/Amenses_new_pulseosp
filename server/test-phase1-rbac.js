/**
 * Comprehensive Automated RBAC Test Suite for Phase 1.
 * Tests:
 * 1. Single source of truth permission helper (`hasPermission`).
 * 2. Role permissions matrix per spec for Owner, Admin, Maintainer, Developer, Viewer.
 * 3. Express middleware `requirePermission` 403 enforcement.
 */

const { hasPermission } = require('./src/config/permissions');
const requirePermission = require('./src/middleware/requirePermission');

function runRbacTests() {
  console.log('=== PHASE 1 RBAC AUTOMATED SUITE ===\n');

  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`✅ PASS: ${message}`);
      passed++;
    } else {
      console.error(`❌ FAIL: ${message}`);
      failed++;
    }
  }

  // ---------------------------------------------------------
  // 1. OWNER PERMISSIONS (Full control)
  // ---------------------------------------------------------
  console.log('--- 1. Testing Owner Role ---');
  assert(hasPermission('owner', 'manage_workspace'), 'Owner can manage/delete workspace');
  assert(hasPermission('owner', 'manage_integrations'), 'Owner can connect/disconnect integrations');
  assert(hasPermission('owner', 'invite_members'), 'Owner can invite team members');
  assert(hasPermission('owner', 'manage_members'), 'Owner can manage member roles');
  assert(hasPermission('owner', 'generate_reports'), 'Owner can generate reports');
  assert(hasPermission('owner', 'view_team'), 'Owner can view team page');
  assert(hasPermission('owner', 'view_developers'), 'Owner can view developers page');

  // ---------------------------------------------------------
  // 2. MAINTAINER / ADMIN PERMISSIONS (Operational power, no destructive/ownership)
  // ---------------------------------------------------------
  console.log('\n--- 2. Testing Maintainer / Admin Role ---');
  ['admin', 'maintainer'].forEach((role) => {
    assert(!hasPermission(role, 'manage_workspace'), `${role} CANNOT manage/delete workspace`);
    assert(hasPermission(role, 'manage_integrations'), `${role} CAN connect/disconnect integrations`);
    assert(hasPermission(role, 'view_integrations'), `${role} CAN view integration status`);
    assert(hasPermission(role, 'invite_members'), `${role} CAN invite members (dev/viewer only)`);
    assert(hasPermission(role, 'view_team'), `${role} CAN view team page`);
    assert(hasPermission(role, 'generate_reports'), `${role} CAN generate reports`);
    assert(hasPermission(role, 'view_developers'), `${role} CAN view developers page`);
    assert(hasPermission(role, 'manage_tasks'), `${role} CAN manage tasks`);
  });

  // ---------------------------------------------------------
  // 3. DEVELOPER PERMISSIONS (Work execution)
  // ---------------------------------------------------------
  console.log('\n--- 3. Testing Developer Role ---');
  assert(!hasPermission('developer', 'manage_workspace'), 'Developer CANNOT manage workspace');
  assert(hasPermission('developer', 'manage_integrations'), 'Developer CAN connect/disconnect integrations');
  assert(hasPermission('developer', 'view_integrations'), 'Developer CAN view integrations page');
  assert(!hasPermission('developer', 'invite_members'), 'Developer CANNOT invite members');
  assert(!hasPermission('developer', 'view_team'), 'Developer CANNOT view team page');
  assert(!hasPermission('developer', 'view_developers'), 'Developer CANNOT view developers page');
  assert(!hasPermission('developer', 'generate_reports'), 'Developer CANNOT generate reports');
  assert(hasPermission('developer', 'view_reports'), 'Developer CAN view/download reports');
  assert(hasPermission('developer', 'view_projects'), 'Developer CAN view workspace/projects');
  assert(hasPermission('developer', 'manage_tasks'), 'Developer CAN manage tasks');

  // ---------------------------------------------------------
  // 4. VIEWER PERMISSIONS (Read-only everywhere)
  // ---------------------------------------------------------
  console.log('\n--- 4. Testing Viewer Role ---');
  assert(!hasPermission('viewer', 'manage_workspace'), 'Viewer CANNOT manage workspace');
  assert(!hasPermission('viewer', 'manage_integrations'), 'Viewer CANNOT manage integrations');
  assert(!hasPermission('viewer', 'view_integrations'), 'Viewer CANNOT view integrations');
  assert(!hasPermission('viewer', 'invite_members'), 'Viewer CANNOT invite members');
  assert(!hasPermission('viewer', 'view_team'), 'Viewer CANNOT view team');
  assert(!hasPermission('viewer', 'view_developers'), 'Viewer CANNOT view developers');
  assert(!hasPermission('viewer', 'view_projects'), 'Viewer CANNOT view workspace projects');
  assert(!hasPermission('viewer', 'generate_reports'), 'Viewer CANNOT generate reports');
  assert(!hasPermission('viewer', 'manage_tasks'), 'Viewer CANNOT manage/create tasks');
  assert(!hasPermission('viewer', 'manage_tickets'), 'Viewer CANNOT manage/create tickets');
  assert(hasPermission('viewer', 'view_reports'), 'Viewer CAN view/download reports');
  assert(hasPermission('viewer', 'view_analytics'), 'Viewer CAN view analytics');
  assert(hasPermission('viewer', 'view_repositories'), 'Viewer CAN view repositories');
  assert(hasPermission('viewer', 'view_communication'), 'Viewer CAN view communication');

  // ---------------------------------------------------------
  // 5. MIDDLEWARE GATING SIMULATION (Express 403 Check)
  // ---------------------------------------------------------
  console.log('\n--- 5. Middleware requirePermission Gating Checks ---');

  const mockRes = () => {
    const res = {};
    res.status = function (code) {
      this.statusCode = code;
      return this;
    };
    res.json = function (payload) {
      this.body = payload;
      return this;
    };
    return res;
  };

  // Middleware test 1: Viewer trying to POST report (generate_reports) -> Expect 403
  const reqViewerReport = { userRole: 'viewer' };
  const resViewerReport = mockRes();
  let nextCalled = false;
  requirePermission('generate_reports')(reqViewerReport, resViewerReport, () => { nextCalled = true; });
  assert(resViewerReport.statusCode === 403 && !nextCalled, 'Middleware blocks Viewer from generate_reports (403)');

  // Middleware test 2: Maintainer connecting integration (manage_integrations) -> Expect next() called
  const reqMaintConnect = { userRole: 'maintainer' };
  const resMaintConnect = mockRes();
  nextCalled = false;
  requirePermission('manage_integrations')(reqMaintConnect, resMaintConnect, () => { nextCalled = true; });
  assert(nextCalled && !resMaintConnect.statusCode, 'Middleware ALLOWS Maintainer to manage_integrations');

  // Middleware test 3: Developer trying to view team (view_team) -> Expect 403
  const reqDevTeam = { userRole: 'developer' };
  const resDevTeam = mockRes();
  nextCalled = false;
  requirePermission('view_team')(reqDevTeam, resDevTeam, () => { nextCalled = true; });
  assert(resDevTeam.statusCode === 403 && !nextCalled, 'Middleware blocks Developer from view_team (403)');

  // Middleware test 4: Owner calling manage_workspace -> Expect Next() called
  const reqOwner = { userRole: 'owner' };
  const resOwner = mockRes();
  nextCalled = false;
  requirePermission('manage_workspace')(reqOwner, resOwner, () => { nextCalled = true; });
  assert(nextCalled && !resOwner.statusCode, 'Middleware allows Owner full manage_workspace access');

  console.log(`\n=== SUMMARY: ${passed} PASSED, ${failed} FAILED ===`);
  if (failed > 0) {
    process.exit(1);
  }
}

runRbacTests();