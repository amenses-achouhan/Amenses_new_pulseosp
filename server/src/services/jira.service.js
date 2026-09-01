const axios = require('axios');
const crypto = require('crypto');

class JiraService {
  constructor() {
    this.clientId = process.env.JIRA_CLIENT_ID;
    this.clientSecret = process.env.JIRA_CLIENT_SECRET;
    this.authUrl = 'https://auth.atlassian.com/authorize';
    this.tokenUrl = 'https://auth.atlassian.com/oauth/token';
    this.apiBaseUrl = 'https://api.atlassian.com';
  }

  get redirectUri() {
    try {
      const { getJiraCallbackUrl } = require('../utils/publicUrl');
      return getJiraCallbackUrl();
    } catch {
      return process.env.JIRA_REDIRECT_URI || process.env.JIRA_CALLBACK_URL;
    }
  }

  getAuthUrl(state) {
    const params = new URLSearchParams({
      audience: 'api.atlassian.com',
      client_id: this.clientId,
      scope: 'read:jira-work read:jira-user manage:jira-webhook offline_access',
      redirect_uri: this.redirectUri,
      response_type: 'code',
      prompt: 'consent',
      state: state,
    });
    return `${this.authUrl}?${params.toString()}`;
  }

  async exchangeCode(code) {
    try {
      const response = await axios.post(this.tokenUrl, {
        grant_type: 'authorization_code',
        client_id: this.clientId,
        client_secret: this.clientSecret,
        code: code,
        redirect_uri: this.redirectUri,
      });

      return {
        accessToken: response.data.access_token,
        refreshToken: response.data.refresh_token,
        expiresIn: response.data.expires_in,
        cloudId: response.data.cloudid || null,
      };
    } catch (error) {
      console.error('Token exchange error:', error.response.data || error.message);
      throw new Error('Failed to exchange Jira OAuth code');
    }
  }

  async refreshAccessToken(refreshToken) {
    try {
      const response = await axios.post(this.tokenUrl, {
        grant_type: 'refresh_token',
        client_id: this.clientId,
        client_secret: this.clientSecret,
        refresh_token: refreshToken,
      });

      return {
        accessToken: response.data.access_token,
        refreshToken: response.data.refresh_token || refreshToken,
        expiresIn: response.data.expires_in,
      };
    } catch (error) {
      console.error('Refresh token error:', error.response && error.response.data || error.message);
      throw new Error('Failed to refresh Jira access token');
    }
  }

  /**
   * Force a fresh access token by always exchanging the refresh token.
   * Used before sensitive operations (e.g. webhook management) so we never
   * present an expired or about-to-expire token to Jira.
   *
   * @param {string} refreshToken - Decrypted OAuth refresh token
   * @returns {Object} { accessToken, refreshToken, expiresIn }
   */
  async forceRefreshAccessToken(refreshToken) {
    const refreshed = await this.refreshAccessToken(refreshToken);
    return refreshed;
  }

  async getAccessibleSites(accessToken) {
    try {
      const response = await axios.get(
        `${this.apiBaseUrl}/oauth/token/accessible-resources`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: 'application/json',
          },
        }
      );
      return response.data;
    } catch (error) {
      console.error('Get sites error:', error.response.data || error.message);
      throw new Error('Failed to get Jira sites');
    }
  }

  async getProjects(accessToken, cloudId) {
    try {
      const response = await axios.get(
        `${this.apiBaseUrl}/ex/jira/${cloudId}/rest/api/3/project`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: 'application/json',
          },
        }
      );
      return response.data;
    } catch (error) {
      const status = error.response && error.response.status;
      const body = error.response && error.response.data;
      const detail = (body && (body.errorMessages || []).join(' ')) || (body && body.message) || error.message;
      console.error('Get projects error:', status, detail);
      const err = new Error(detail || 'Failed to get Jira projects');
      err.status = status;
      throw err;
    }
  }

  async getIssues(accessToken, cloudId, jql = '', nextPageToken = '', maxResults = 50) {
    try {
      // Jira Cloud removed GET /rest/api/3/search (CHANGE-2046). Use POST
      // /rest/api/3/search/jql. `fields` must be an ARRAY (not a comma string),
      // pagination is cursor-based via nextPageToken / isLast (no startAt/total).
      const response = await axios.post(
        `${this.apiBaseUrl}/ex/jira/${cloudId}/rest/api/3/search/jql`,
        {
          jql: jql,
          maxResults: maxResults,
          fields: [
            'summary',
            'description',
            'issuetype',
            'status',
            'priority',
            'assignee',
            'reporter',
            'created',
            'updated',
            'resolutiondate',
            'timeestimate',
            'timespent',
            'labels',
            'components',
            'project',
          ],
          ...(nextPageToken ? { nextPageToken } : {}),
        },
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
        }
      );
      const data = response.data || {};
      return {
        issues: data.issues || [],
        nextPageToken: data.nextPageToken || '',
        // Primary termination signal: no nextPageToken in response.
        // isLast is a secondary signal — Atlassian sometimes omits it,
        // so we must not treat its absence as meaning "is last page".
        isLast: data.isLast === true || !data.nextPageToken,
      };
    } catch (error) {
      const status = error.response && error.response.status;
      const body = error.response && error.response.data;
      const detail =
        (body && (body.errorMessages || []).join(' ')) ||
        (body && body.message) ||
        error.message;
      console.error('Get issues error:', status, detail);
      // Re-throw with the status so routes can map it to a meaningful response.
      const err = new Error(detail || 'Failed to get Jira issues');
      err.status = status;
      throw err;
    }
  }

  async registerWebhook(accessToken, cloudId, webhookUrl, projectKey, secret) {
    try {
      // Jira Cloud REST API v3 — requires manage:jira-webhook OAuth 2.0 scope.
      // Supported Jira Cloud REST API v3 event IDs.
      const validEvents = [
        'jira:issue_created',
        'jira:issue_updated',
        'jira:issue_deleted',
        'comment_created',
        'comment_updated',
        'comment_deleted',
      ];

      const response = await axios.post(
        `${this.apiBaseUrl}/ex/jira/${cloudId}/rest/api/3/webhook`,
        {
          url: webhookUrl,
          webhooks: [
            {
              events: validEvents,
              jqlFilter: `project = ${projectKey}`,
            },
          ],
        },
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
        }
      );
      const result = response.data?.webhookRegistrationResult?.[0];
      if (!result || !result.createdWebhookId) {
        const errMsg = (result?.errors || []).join(', ') || 'No webhook ID returned from Jira';
        const err = new Error(errMsg);
        err.status = 400;
        throw err;
      }
      // Normalise to a shape the route already consumes: { id, url, events }
      return {
        id: result.createdWebhookId,
        url: webhookUrl,
        events: validEvents,
      };
    } catch (error) {
      if (error.status && !error.response) throw error; // already normalised
      const status = error.response && error.response.status;
      const body = error.response && error.response.data;
      const detail = (body && (body.errorMessages || []).join(' ')) || (body && body.message) || error.message;
      console.error('Register webhook error:', status, detail);
      const err = new Error(detail || 'Failed to register Jira webhook');
      err.status = status;
      throw err;
    }
  }

  /**
   * Pre-check that the OAuth token has the manage:jira-webhook scope and the
   * user can administer webhooks on the site. Listing webhooks exercises the
   * same permission surface as creating them, so a 401/403 here means the
   * registration attempt would be doomed.
   *
   * @param {string} accessToken - OAuth access token
   * @param {string} cloudId - Jira Cloud ID
   * @returns {Array} Existing remote webhooks
   */
  async listWebhooks(accessToken, cloudId) {
    try {
      const response = await axios.get(
        `${this.apiBaseUrl}/ex/jira/${cloudId}/rest/api/3/webhook`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: 'application/json',
          },
        }
      );
      return response.data?.values || [];
    } catch (error) {
      const status = error.response && error.response.status;
      const body = error.response && error.response.data;
      const detail = (body && (body.errorMessages || []).join(' ')) || (body && body.message) || error.message;
      console.error('List webhooks error:', status, detail);
      const err = new Error(detail || 'Failed to list Jira webhooks');
      err.status = status;
      throw err;
    }
  }

  /**
   * Renew webhook expirations so Jira does not silently delete our webhooks.
   * Classic Jira webhooks expire (~30 days) unless renewed.
   *
   * @param {string} accessToken - OAuth access token
   * @param {string} cloudId - Jira Cloud ID
   * @param {number[]} webhookIds - Webhook IDs to renew
   * @returns {Object|null} Response containing new expirationDate (epoch ms), or null on failure
   */
  async renewWebhooks(accessToken, cloudId, webhookIds) {
    if (!Array.isArray(webhookIds) || webhookIds.length === 0) return null;
    try {
      // v3 refresh endpoint returns { expirationDate: <epoch ms> } for all
      // renewed webhooks at once. Normalise to { webhooks: [{ expirationDate }] }
      // so the caller (integrationRoutes register-webhook) does not need changes.
      const response = await axios.put(
        `${this.apiBaseUrl}/ex/jira/${cloudId}/rest/api/3/webhook/refresh`,
        { webhookIds },
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
        }
      );
      const expirationDate = response.data?.expirationDate;
      return expirationDate ? { webhooks: [{ expirationDate }] } : null;
    } catch (error) {
      // Renewal is best-effort; registration/verification already succeeded.
      console.error('Renew webhooks error:', error.response && error.response.status, error.message);
      return null;
    }
  }

  /**
   * List all webhooks for a Jira Cloud instance
   * @param {string} accessToken - OAuth access token
   * @param {string} cloudId - Jira Cloud ID
   * @returns {Array} Array of webhook objects
   */
  async getWebhooks(accessToken, cloudId) {
    try {
      const response = await axios.get(
        `${this.apiBaseUrl}/ex/jira/${cloudId}/rest/api/3/webhook`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: 'application/json',
          },
        }
      );
      return response.data?.values || [];
    } catch (error) {
      const status = error.response && error.response.status;
      const body = error.response && error.response.data;
      const detail = (body && (body.errorMessages || []).join(' ')) || (body && body.message) || error.message;
      console.error('Get webhooks error:', status, detail);
      const err = new Error(detail || 'Failed to get Jira webhooks');
      err.status = status;
      throw err;
    }
  }

  /**
   * Find a matching webhook by URL and project filter
   * @param {string} accessToken - OAuth access token
   * @param {string} cloudId - Jira Cloud ID
   * @param {string} webhookUrl - Expected webhook URL
   * @param {string} projectKey - Project key to filter by
   * @returns {Object|null} Matching webhook or null
   */
  async findMatchingWebhook(accessToken, cloudId, webhookUrl, projectKey) {
    try {
      const webhooks = await this.getWebhooks(accessToken, cloudId);
      // v3 GET /webhook only returns webhooks registered by this OAuth client,
      // and does not include the webhook URL in the response. Match on jqlFilter
      // and events instead; inject the known URL for downstream consumers.
      for (const webhook of webhooks) {
        const filterMatch = !projectKey || (webhook.jqlFilter || '').includes(projectKey);
        if (filterMatch && this.eventsMatch(webhook.events || [])) {
          return { ...webhook, url: webhookUrl };
        }
      }
      return null;
    } catch (error) {
      // 404 (no webhooks) is the normal "none exists yet" case. Any other
      // failure (e.g. 401 scope/permission) must propagate so the route can
      // surface the real Jira error instead of masking it and attempting a
      // doomed registration.
      if (error.response && error.response.status === 404) {
        return null;
      }
      console.error('Find matching webhook error:', error.response && error.response.status, error.message);
      throw error;
    }
  }

  /**
   * Verify a webhook exists remotely and matches our criteria
   * @param {string} accessToken - OAuth access token
   * @param {string} cloudId - Jira Cloud ID
   * @param {string} webhookId - Webhook ID to verify
   * @param {string} webhookUrl - Expected webhook URL
   * @param {string} projectKey - Project key to filter by
   * @returns {Object} Verification result
   */
  async verifyWebhook(accessToken, cloudId, webhookId, webhookUrl, projectKey) {
    try {
      // v3 has no GET-by-ID endpoint. List all webhooks registered by this
      // OAuth client and find the one matching our ID.
      const webhooks = await this.getWebhooks(accessToken, cloudId);
      const webhook = webhooks.find(w => String(w.id) === String(webhookId));
      if (!webhook) {
        return { exists: false, matches: {}, allMatch: false };
      }

      // v3 does not return the webhook URL in list responses; set url: true
      // because the URL was supplied by us at registration time.
      const matches = {
        id: String(webhook.id) === String(webhookId),
        url: true,
        events: this.eventsMatch(webhook.events || []),
        projectFilter: !projectKey || (webhook.jqlFilter || '').includes(projectKey),
      };

      return {
        exists: true,
        webhook: { ...webhook, url: webhookUrl }, // inject known URL for downstream
        matches,
        allMatch: Object.values(matches).every(v => v === true),
      };
    } catch (error) {
      if (error.response?.status === 404) {
        return { exists: false, matches: {}, allMatch: false };
      }
      console.error('Verify webhook error:', error.response?.data || error.message);
      throw new Error('Failed to verify Jira webhook');
    }
  }

  /**
   * Check if webhook events match our required events
   * @param {Array} events - Webhook events array
   * @returns {boolean}
   */
  eventsMatch(events) {
    const required = [
      'jira:issue_created', 'jira:issue_updated', 'jira:issue_deleted',
      'comment_created', 'comment_updated', 'comment_deleted'
    ];
    return required.every(e => events.includes(e));
  }

  /**
   * Generate a secure webhook secret for JWT verification
   * @returns {string} Base64 encoded secret
   */
  generateWebhookSecret() {
    return crypto.randomBytes(32).toString('base64');
  }

  async deleteWebhook(accessToken, cloudId, webhookId) {
    try {
      // v3 DELETE is body-based (bulk), not a path-parameter DELETE.
      await axios.delete(
        `${this.apiBaseUrl}/ex/jira/${cloudId}/rest/api/3/webhook`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          data: { webhookIds: [Number(webhookId)] },
        }
      );
      return true;
    } catch (error) {
      console.error('Delete webhook error:', error.response?.data || error.message);
      return false;
    }
  }
}

module.exports = new JiraService();