const { GoogleGenerativeAI } = require('@google/generative-ai');
const { validateWithRetry } = require('../../ai/validation/ai-summary.validation');

// Initialize Gemini
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
if (!GEMINI_API_KEY && process.env.NODE_ENV === 'production') {
  console.error('[gemini] GEMINI_API_KEY is not set — AI summary generation will fail in production');
}
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

// Define output schema interface (for JSDoc)
/**
 * @typedef {Object} AISummary
 * @property {string} summary
 * @property {Object} key_metrics
 * @property {number} key_metrics.prs_merged
 * @property {number} key_metrics.prs_opened
 * @property {number} key_metrics.active_developers
 * @property {number} key_metrics.jira_issues_completed
 * @property {number} key_metrics.jira_issues_created
 * @property {number} key_metrics.slack_messages
 * @property {string[]} top_contributors
 * @property {string[]} risks
 * @property {string[]} recommendations
 */

/**
 * Build prompt for Gemini with structured output requirements
 * @param {string} context - The activity context from context builder
 * @param {string} summaryType - Type of summary (weekly, monthly, etc.)
 * @returns {string} Formatted prompt for Gemini
 */
function buildPrompt(context, summaryType) {
  return `
You are an Engineering Operations Analyst. Based on activity data below, generate comprehensive engineering health summary.

SUMMARY TYPE: ${summaryType}

ACTIVITY DATA:
${context}

TASK: Create structured engineering health report with following sections:

1. **Summary**: A 2-3 sentence executive summary of team's engineering health and velocity.

2. **Key Metrics**: Extract or calculate these metrics from data:
  - prs_merged: Number of pull requests merged
  - prs_opened: Number of pull requests opened
  - active_developers: Number of unique developers who committed code or reviewed PRs
  - jira_issues_completed: Number of Jira issues marked as completed/Done
  - jira_issues_created: Number of new Jira issues created
  - slack_messages: Total Slack messages in engineering channels

3. **Top Contributors**: List top 3-5 most active contributors (by PRs, reviews, or issue resolution).

4. **Risks**: Identify 2-3 potential risks or blockers (e.g., PRs stuck in review, failing builds, sprint velocity dip, unassigned critical issues).

5. **Recommendations**: Provide 2-3 actionable recommendations for engineering manager.

Return ONLY valid JSON object with this exact structure:
{
  "summary": "string",
  "key_metrics": {
    "prs_merged": number,
    "prs_opened": number,
    "active_developers": number,
    "jira_issues_completed": number,
    "jira_issues_created": number,
    "slack_messages": number
  },
  "top_contributors": ["string"],
  "risks": ["string"],
  "recommendations": ["string"]
}

Important:
- All numeric fields must be integers
- If metric is not available in data, estimate 0
- Be specific, use actual numbers from data
- Make summary actionable and insightful
`;
}

// Singleton-style model config. `gemini-1.5-pro` was retired on the v1beta
// generateContent endpoint; default to a currently served model and allow an
// override via env so future deprecations are a config change, not a code one.
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.6-flash';

/**
 * Extract the outermost JSON object from a model response. Handles markdown
 * code fences (```json … ```), leading/trailing prose, and stray whitespace.
 * @param {string} text - Raw model output
 * @returns {string} The JSON object substring
 */
function extractJsonObject(text) {
  const raw = String(text || '');
  const start = raw.indexOf('{');
  if (start === -1) return raw.trim();
  // Scan for the matching closing brace, ignoring braces inside strings.
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < raw.length; i++) {
    const ch = raw[i];
    if (escaped) { escaped = false; continue; }
    if (ch === '\\') { escaped = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{') depth++;
    if (ch === '}') {
      depth--;
      if (depth === 0) return raw.slice(start, i + 1);
    }
  }
  // Unbalanced (likely truncated) — return what we have so the caller's parse
  // error message reflects reality.
  return raw.slice(start).trim();
}

// Gemini service class
class GeminiService {
  /**
   * @constructor
   */
  constructor() {
    this.model = genAI.getGenerativeModel({
      model: GEMINI_MODEL,
      generationConfig: {
        temperature: 0.3,
        topK: 32,
        topP: 0.95,
        // Generous ceiling: a truncated response would break JSON.parse.
        maxOutputTokens: 4096,
        responseMimeType: 'application/json',
      },
    });
    console.log(`[gemini] using model: ${GEMINI_MODEL}`);
  }

  /**
   * Generate AI summary from context with validation and retry
   * @param {string} context - Activity context string
   * @param {string} summaryType - Type of summary to generate
   * @returns {Promise<AISummary>} Parsed and validated AI summary
   */
  async generateSummary(context, summaryType = 'Weekly Engineering Summary') {
    if (!GEMINI_API_KEY) {
      throw new Error('GEMINI_API_KEY is not configured on this server. Set it in server/.env');
    }
    return await validateWithRetry(
      async () => {
        const prompt = buildPrompt(context, summaryType);

        // Log prompt for debugging (in development)
        if (process.env.NODE_ENV !== 'production') {
          console.log('📝 Gemini Prompt:', prompt.substring(0, 500) + '...');
        }

        // Generate response
        const result = await this.model.generateContent(prompt);
        const response = await result.response;
        const text = response.text();

        // Parse JSON response. Some models wrap JSON in markdown fences or
        // prepend prose, so extract the outermost {...} block before parsing.
        let parsed;
        try {
          parsed = JSON.parse(extractJsonObject(text));
        } catch (parseError) {
          console.error('❌ Failed to parse Gemini JSON response:', parseError.message);
          console.error('Raw response:', text);
          throw new Error('Invalid JSON response from Gemini');
        }

        // Validate required fields
        if (!parsed.summary || !parsed.key_metrics) {
          throw new Error('Missing required fields in Gemini response');
        }

        // Ensure numeric fields are integers
        parsed.key_metrics.prs_merged = parseInt(parsed.key_metrics.prs_merged) || 0;
        parsed.key_metrics.prs_opened = parseInt(parsed.key_metrics.prs_opened) || 0;
        parsed.key_metrics.active_developers = parseInt(parsed.key_metrics.active_developers) || 0;
        parsed.key_metrics.jira_issues_completed = parseInt(parsed.key_metrics.jira_issues_completed) || 0;
        parsed.key_metrics.jira_issues_created = parseInt(parsed.key_metrics.jira_issues_created) || 0;
        parsed.key_metrics.slack_messages = parseInt(parsed.key_metrics.slack_messages) || 0;

        // Ensure arrays are present
        parsed.top_contributors = Array.isArray(parsed.top_contributors) ? parsed.top_contributors : [];
        parsed.risks = Array.isArray(parsed.risks) ? parsed.risks : [];
        parsed.recommendations = Array.isArray(parsed.recommendations) ? parsed.recommendations : [];

        console.log('✅ Gemini Response parsed successfully');
        return parsed;
      },
      2, // maxRetries
      1000 // initial delay in ms
    );
  }
}

// Singleton instance
const geminiService = new GeminiService();
module.exports = { geminiService };
