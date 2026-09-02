/**
 * inject-test-data.js — Inject test activity data for AI summary testing
 * Run: node scripts/inject-test-data.js
 */

require('dotenv').config({ path: '.env' });
const mongoose = require('mongoose');
const connectDB = require('../src/config/db');
const Activity = require('../src/models/Activity');

// Use the first organization from the database
const TEST_ORG_ID = '6a85a2c34a3f09d3b6413889'; // Valid ObjectId from database

async function injectTestData() {
  try {
    console.log('🚀 Injecting test data for AI summary testing...');
    
    // Connect to MongoDB
    await connectDB();
    console.log('✅ Connected to MongoDB');

    // Clear old test data
    await Activity.deleteMany({ organizationId: TEST_ORG_ID });
    console.log('✅ Cleared old test data');

    const now = Date.now();
    const minutesAgo = (m) => new Date(now - m * 60 * 1000);

    // Create test activities matching the Activity model schema
    const activities = [
      // GitHub PR activities
      {
        organizationId: TEST_ORG_ID,
        source: 'github',
        sourceId: 'pr_123456_opened',
        actor: 'priya-shah',
        timestamp: minutesAgo(60 * 2), // 2 hours ago
        type: 'pr_opened',
        metadata: {
          repository: 'pulseops-backend',
          fullName: 'acme/pulseops-backend',
          prNumber: 123,
          prTitle: 'Add AI summary feature for PulseOps',
          prState: 'open',
          action: 'opened',
          event_type: 'pr_opened'
        }
      },
      {
        organizationId: TEST_ORG_ID,
        source: 'github',
        sourceId: 'pr_123457_merged',
        actor: 'daniel-kim',
        timestamp: minutesAgo(60 * 4), // 4 hours ago
        type: 'pr_merged',
        metadata: {
          repository: 'pulseops-backend',
          fullName: 'acme/pulseops-backend',
          prNumber: 122,
          prTitle: 'Fix authentication bug in middleware',
          prState: 'merged',
          action: 'closed',
          merged: true,
          event_type: 'pr_merged'
        }
      },
      {
        organizationId: TEST_ORG_ID,
        source: 'github',
        sourceId: 'pr_123458_opened',
        actor: 'alex-chen',
        timestamp: minutesAgo(60 * 8), // 8 hours ago
        type: 'pr_opened',
        metadata: {
          repository: 'pulseops-frontend',
          fullName: 'acme/pulseops-frontend',
          prNumber: 45,
          prTitle: 'Implement dashboard analytics charts',
          prState: 'open',
          action: 'opened',
          event_type: 'pr_opened'
        }
      },
      {
        organizationId: TEST_ORG_ID,
        source: 'github',
        sourceId: 'pr_123459_merged',
        actor: 'priya-shah',
        timestamp: minutesAgo(60 * 12), // 12 hours ago
        type: 'pr_merged',
        metadata: {
          repository: 'pulseops-api',
          fullName: 'acme/pulseops-api',
          prNumber: 78,
          prTitle: 'Add Jira webhook integration',
          prState: 'merged',
          action: 'closed',
          merged: true,
          event_type: 'pr_merged'
        }
      },
      {
        organizationId: TEST_ORG_ID,
        source: 'github',
        sourceId: 'push_123460',
        actor: 'sam-wilson',
        timestamp: minutesAgo(60 * 6), // 6 hours ago
        type: 'push',
        metadata: {
          repository: 'pulseops-backend',
          ref: 'refs/heads/main',
          commits: [
            { message: 'feat: add slack normalization' },
            { message: 'fix: handle edge case in parser' }
          ],
          event_type: 'push'
        }
      },

      // Slack activities
      {
        organizationId: TEST_ORG_ID,
        source: 'slack',
        sourceId: 'C123456_1234567890',
        actor: 'priya-shah',
        timestamp: minutesAgo(30), // 30 minutes ago
        type: 'message',
        metadata: {
          channel: { name: 'backend-dev', id: 'C123456' },
          text: 'Need help with the deployment pipeline failing',
          ts: '1234567890.123456',
          event_type: 'message'
        }
      },
      {
        organizationId: TEST_ORG_ID,
        source: 'slack',
        sourceId: 'C123456_1234567891',
        actor: 'daniel-kim',
        timestamp: minutesAgo(45), // 45 minutes ago
        type: 'message',
        metadata: {
          channel: { name: 'backend-dev', id: 'C123456' },
          text: 'The CI pipeline is now passing, merging PR #122',
          ts: '1234567891.123456',
          event_type: 'message'
        }
      },
      {
        organizationId: TEST_ORG_ID,
        source: 'slack',
        sourceId: 'C123457_1234567892',
        actor: 'alex-chen',
        timestamp: minutesAgo(60 * 2), // 2 hours ago
        type: 'message',
        metadata: {
          channel: { name: 'frontend-dev', id: 'C123457' },
          text: 'Dashboard charts are ready for review',
          ts: '1234567892.123456',
          event_type: 'message'
        }
      },
      {
        organizationId: TEST_ORG_ID,
        source: 'slack',
        sourceId: 'C123456_1234567893',
        actor: 'sam-wilson',
        timestamp: minutesAgo(60 * 3), // 3 hours ago
        type: 'file_share',
        metadata: {
          channel: { name: 'general', id: 'C123456' },
          files: [{ name: 'architecture-decision.pdf', size: 102400 }],
          event_type: 'file_share'
        }
      },

      // Jira activities
      {
        organizationId: TEST_ORG_ID,
        source: 'jira',
        sourceId: 'ENG-123_created',
        actor: 'priya-shah',
        timestamp: minutesAgo(60 * 6), // 6 hours ago
        type: 'issue_created',
        metadata: {
          issueKey: 'ENG-123',
          issueSummary: 'Implement AI summary generator with Gemini',
          status: 'Backlog',
          event_type: 'issue_created'
        }
      },
      {
        organizationId: TEST_ORG_ID,
        source: 'jira',
        sourceId: 'ENG-124_created',
        actor: 'daniel-kim',
        timestamp: minutesAgo(60 * 5), // 5 hours ago
        type: 'issue_created',
        metadata: {
          issueKey: 'ENG-124',
          issueSummary: 'Fix memory leak in slack sync worker',
          status: 'In Progress',
          event_type: 'issue_created'
        }
      },
      {
        organizationId: TEST_ORG_ID,
        source: 'jira',
        sourceId: 'ENG-121_completed',
        actor: 'alex-chen',
        timestamp: minutesAgo(60 * 10), // 10 hours ago
        type: 'issue_completed',
        metadata: {
          issueKey: 'ENG-121',
          issueSummary: 'Add dark mode support to dashboard',
          status: 'Done',
          event_type: 'issue_completed'
        }
      },
      {
        organizationId: TEST_ORG_ID,
        source: 'jira',
        sourceId: 'ENG-120_completed',
        actor: 'sam-wilson',
        timestamp: minutesAgo(60 * 14), // 14 hours ago
        type: 'issue_completed',
        metadata: {
          issueKey: 'ENG-120',
          issueSummary: 'Optimize database queries for analytics',
          status: 'Done',
          event_type: 'issue_completed'
        }
      },
      {
        organizationId: TEST_ORG_ID,
        source: 'jira',
        sourceId: 'ENG-122_updated',
        actor: 'priya-shah',
        timestamp: minutesAgo(60 * 3), // 3 hours ago
        type: 'issue_updated',
        metadata: {
          issueKey: 'ENG-122',
          issueSummary: 'Refactor authentication service',
          status: 'In Progress',
          event_type: 'issue_updated'
        }
      }
    ];

    // Insert all activities
    const result = await Activity.insertMany(activities);
    console.log(`✅ Inserted ${result.length} test activities`);

    // Print summary by type
    const byType = result.reduce((acc, r) => { 
      acc[r.type] = (acc[r.type] || 0) + 1; 
      return acc; 
    }, {});
    console.log('📊 By type:', JSON.stringify(byType, null, 2));

    const bySource = result.reduce((acc, r) => { 
      acc[r.source] = (acc[r.source] || 0) + 1; 
      return acc; 
    }, {});
    console.log('📊 By source:', JSON.stringify(bySource, null, 2));

    console.log('\n✅ Test data injected successfully!');
    console.log('Now you can:');
    console.log('1. Start the Express server: node server.js');
    console.log('2. Start the Next.js client: npm run dev (in client/)');
    console.log('3. Log in and navigate to /workspace/org_123/analytics');
    console.log('4. Navigate to /workspace/org_123/reports and click "Generate Summary"');
    console.log('5. Or test AI summary API directly:');
    console.log('   curl -X POST http://localhost:5000/api/ai-summaries \\');
    console.log('     -H "Content-Type: application/json" \\');
    console.log('     -H "Authorization: Bearer <your-jwt-token>" \\');
    console.log('     -H "x-organization-id: org_123" \\');
    console.log('     -d \'{"organizationId": "org_123", "type": "weekly"}\'');

    await mongoose.connection.close();
    console.log('✅ Done');
    process.exit(0);

  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

injectTestData();