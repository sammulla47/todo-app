/**
 * api.js — thin client around the Google Apps Script Web App REST API.
 *
 * IMPORTANT: set API_CONFIG.BASE_URL below to your deployed Apps Script
 * Web App URL (Deploy → Manage deployments → Web app → URL). This is a
 * public endpoint by design — no secret keys or credentials belong here.
 */

const API_CONFIG = Object.freeze({
  // e.g. "https://script.google.com/macros/s/AKfycb.../exec"
  BASE_URL: 'https://script.google.com/macros/s/AKfycbyGYvRTHvNWWC-EnNKE3XWBZrOzL_I48P_a21TXVS0UkKYGIt4ZmUHxi-_TgBRzxGeL/exec',
  TIMEOUT_MS: 15000,
});

class ApiError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'ApiError';
    this.code = code || 'UNKNOWN';
  }
}

function isApiConfigured() {
  return (
    typeof API_CONFIG.BASE_URL === 'string' &&
    API_CONFIG.BASE_URL.indexOf('https://script.google.com') === 0
  );
}

function withTimeout_(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new ApiError('Request timed out. Please try again.', 'TIMEOUT')), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Performs a GET request with query params (used for reads).
 */
async function apiGet_(action, params) {
  if (!isApiConfigured()) {
    throw new ApiError(
      'The backend URL is not configured yet. Open js/api.js and set API_CONFIG.BASE_URL.',
      'NOT_CONFIGURED'
    );
  }
  const url = new URL(API_CONFIG.BASE_URL);
  url.searchParams.set('action', action);
  Object.keys(params || {}).forEach((k) => {
    if (params[k] !== undefined && params[k] !== null && params[k] !== '') {
      url.searchParams.set(k, params[k]);
    }
  });

  let res;
  try {
    res = await withTimeout_(fetch(url.toString(), { method: 'GET' }), API_CONFIG.TIMEOUT_MS);
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw new ApiError('Network error — please check your connection.', 'NETWORK_ERROR');
  }
  return parseResponse_(res);
}

/**
 * Performs a POST request with a JSON body (used for writes).
 * Content-Type is intentionally "text/plain" to keep the request a CORS
 * "simple request" — Apps Script Web Apps do not handle preflight (OPTIONS)
 * reliably, so this avoids the preflight entirely.
 */
async function apiPost_(action, body) {
  if (!isApiConfigured()) {
    throw new ApiError(
      'The backend URL is not configured yet. Open js/api.js and set API_CONFIG.BASE_URL.',
      'NOT_CONFIGURED'
    );
  }
  const payload = Object.assign({ action }, body);

  let res;
  try {
    res = await withTimeout_(
      fetch(API_CONFIG.BASE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload),
      }),
      API_CONFIG.TIMEOUT_MS
    );
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw new ApiError('Network error — please check your connection.', 'NETWORK_ERROR');
  }
  return parseResponse_(res);
}

async function parseResponse_(res) {
  let json;
  try {
    json = await res.json();
  } catch (err) {
    throw new ApiError('The server returned an unexpected response.', 'BAD_RESPONSE');
  }
  if (!res.ok) {
    throw new ApiError(json.error || 'Request failed (' + res.status + ').', json.code || 'HTTP_ERROR');
  }
  if (!json.success) {
    throw new ApiError(json.error || 'Request failed.', json.code || 'API_ERROR');
  }
  return json.data;
}

/* ---------------------------------------------------------------------- *
 * Public API
 * ---------------------------------------------------------------------- */

const Api = {
  /**
   * @param {{search?:string, status?:string, priority?:string, dueDate?:string, sort?:string}} filters
   */
  async listTasks(filters) {
    return apiGet_('list', filters || {});
  },

  async getTask(id) {
    return apiGet_('get', { id });
  },

  async createTask(task) {
    return apiPost_('create', { task });
  },

  async updateTask(id, task) {
    return apiPost_('update', { id, task });
  },

  async deleteTask(id) {
    return apiPost_('delete', { id });
  },
};
