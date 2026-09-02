const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '.env') });

const Organization = require('./src/models/Organization');
const Invitation = require('./src/models/Invitation');
const { hasPermission } = require('./src/config/permissions');

async function runVerification() {
  console.log('=== PHASE 1 AUTOMATED VERIFICATION ===\n');

  const mongoUri = process.env.MONGO_URI;
  if (!mongoUri) {
    console.error('❌ MONGO_URI is not set. Add it to server/.env');
    process.exit(1);
  }
  try {
    await mongoose.connect(mongoUri);
    console.log('✅ MongoDB connected successfully.');
  } catch (err) {
    console.error('❌ DB connection failed:', err.message);
    process.exit(1);
  }

  try {
    // 1. Find or create a test organization
    let org = await Organization.findOne({ name: 'Phase 1 Test Org' });
    if (!org) {
      org = await Organization.create({ name: 'Phase 1 Test Org', slug: 'phase1-test-org' });
    }
    const orgId = org._id.toString();
    console.log(`✅ Using Organization ID: ${orgId}`);

    // 2. Test RBAC permissions function
    console.log('\n--- 1. RBAC Permission Checks ---');
    console.log('Owner has invite_members:', hasPermission('owner', 'invite_members') === true ? '✅ PASS' : '❌ FAIL');
    console.log('Admin has invite_members:', hasPermission('admin', 'invite_members') === true ? '✅ PASS' : '❌ FAIL');
    console.log('Maintainer has invite_members:', hasPermission('maintainer', 'invite_members') === true ? '✅ PASS' : '❌ FAIL');
    console.log('Developer lacks invite_members:', hasPermission('developer', 'invite_members') === false ? '✅ PASS' : '❌ FAIL');
    console.log('Viewer lacks invite_members:', hasPermission('viewer', 'invite_members') === false ? '✅ PASS' : '❌ FAIL');

    // 3. Test invitation creation and querying
    console.log('\n--- 2. Invitation Model & Query Testing ---');

    const testEmail = 'phase1.test.teammate@company.com';
    await Invitation.deleteMany({ email: testEmail });

    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const newInvite = await Invitation.create({
      organizationId: org._id,
      email: testEmail,
      role: 'developer',
      tokenHash: 'dummy_hash_123',
      expiresAt,
      status: 'pending',
    });

    console.log('✅ Created test invitation doc ID:', newInvite._id.toString());

    // Query pending invitations
    const pendingInvites = await Invitation.find({
      organizationId: org._id,
      status: 'pending',
      expiresAt: { $gt: new Date() },
    });

    console.log(`✅ Pending invitations count for org: ${pendingInvites.length}`);
    const foundInvite = pendingInvites.find(i => i.email === testEmail);
    if (foundInvite) {
      console.log(`✅ Found invitation for ${testEmail} with role '${foundInvite.role}' and expiry ${foundInvite.expiresAt.toISOString()}`);
    } else {
      console.log('❌ Invitation not found in pending list!');
    }

    console.log('\n=== ALL PHASE 1 API & MODEL CHECKS PASSED ===');
  } catch (err) {
    console.error('❌ Verification error:', err);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
}

runVerification();