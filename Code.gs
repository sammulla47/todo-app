/**
 * ============================================================================
 *  TODO LIST APP — Google Apps Script Backend
 * ============================================================================
 *  REST-style JSON API backed by a Google Sheet.
 *
 *  Endpoints (single Web App URL, routed by "action"):
 *    GET  ?action=list&search=&status=&priority=&dueDate=&sort=
 *    GET  ?action=get&id=<id>
 *    POST { action: "create", task: {...} }
 *    POST { action: "update", id: "<id>", task: {...} }
 *    POST { action: "delete", id: "<id>" }
 *
 *  IMPORTANT — DEPLOYMENT
 *    1. Create/open a Google Sheet, copy its ID into CONFIG.SPREADSHEET_ID
 *       below (or, better, set it as a Script Property — see README).
 *    2. Extensions → Apps Script → paste this file in as Code.gs.
 *    3. Deploy → New deployment → type: "Web app".
 *         - Execute as: Me
 *         - Who has access: Anyone
 *    4. Copy the deployment URL into js/api.js (API_CONFIG.BASE_URL).
 *
 *  No credentials, API keys, or the Spreadsheet ID are ever sent to the
 *  frontend. The only thing the client holds is the public Web App URL.
 * ============================================================================
 */

/* --------------------------------------------------------------------------
 * CONFIG
 * ------------------------------------------------------------------------ */

const CONFIG = {
  // Prefer Script Properties (File > Project properties > Script properties)
  // over hardcoding. Falls back to the hardcoded value if the property
  // isn't set, so this still works out-of-the-box for a quick deploy.
  SPREADSHEET_ID: getScriptProp_('SPREADSHEET_ID', 'PUT_YOUR_SPREADSHEET_ID_HERE'),
  SHEET_NAME: getScriptProp_('SHEET_NAME', 'Tasks'),
  TIMEZONE: 'Asia/Kolkata',
};

const HEADERS = [
  'ID', 'Task', 'Due Date', 'Priority', 'Status',
  'Notes', 'Created At', 'Updated At', 'Completed At',
];

const PRIORITIES = ['High', 'Medium', 'Low'];
const STATUSES = ['Not Started', 'In Progress', 'On Hold', 'Completed'];

const LIMITS = {
  TASK_MAX: 200,
  NOTES_MAX: 2000,
};

/* --------------------------------------------------------------------------
 * ENTRY POINTS
 * ------------------------------------------------------------------------ */

function doGet(e) {
  try {
    const params = (e && e.parameter) || {};
    const action = params.action || 'list';

    switch (action) {
      case 'list':
        return jsonResponse(true, getTasks(params));
      case 'get':
        return handleGetOne_(params.id);
      case 'ping':
        return jsonResponse(true, { pong: true, time: nowIso_() });
      default:
        return jsonResponse(false, null, 'Unknown action: ' + action, 'BAD_ACTION');
    }
  } catch (err) {
    return jsonResponse(false, null, 'Server error: ' + err.message, 'SERVER_ERROR');
  }
}

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return jsonResponse(false, null, 'Missing request body', 'BAD_REQUEST');
    }

    let body;
    try {
      body = JSON.parse(e.postData.contents);
    } catch (parseErr) {
      return jsonResponse(false, null, 'Invalid JSON body', 'BAD_JSON');
    }

    const action = body.action;

    switch (action) {
      case 'create':
        return handleCreate_(body.task);
      case 'update':
        return handleUpdate_(body.id, body.task);
      case 'delete':
        return handleDelete_(body.id);
      default:
        return jsonResponse(false, null, 'Unknown action: ' + action, 'BAD_ACTION');
    }
  } catch (err) {
    return jsonResponse(false, null, 'Server error: ' + err.message, 'SERVER_ERROR');
  }
}

// Some browsers issue a preflight even for "simple" requests in edge cases.
// Apps Script can't fully customize preflight responses, but we handle it
// defensively so it never throws an unhandled error.
function doOptions() {
  return ContentService.createTextOutput('');
}

/* --------------------------------------------------------------------------
 * ROUTE HANDLERS
 * ------------------------------------------------------------------------ */

function handleGetOne_(id) {
  if (!id) return jsonResponse(false, null, 'Missing id', 'VALIDATION_ERROR');
  const sheet = getSheet_();
  const row = findRowById_(sheet, id);
  if (!row) return jsonResponse(false, null, 'Task not found', 'NOT_FOUND');
  return jsonResponse(true, rowToTask_(row.values));
}

function handleCreate_(taskInput) {
  const errors = validateTask(taskInput || {}, false);
  if (errors.length) {
    return jsonResponse(false, null, errors.join(' '), 'VALIDATION_ERROR');
  }
  const task = createTask(taskInput);
  return jsonResponse(true, task, null, null, 'Task created');
}

function handleUpdate_(id, taskInput) {
  if (!id) return jsonResponse(false, null, 'Missing id', 'VALIDATION_ERROR');
  const errors = validateTask(taskInput || {}, true);
  if (errors.length) {
    return jsonResponse(false, null, errors.join(' '), 'VALIDATION_ERROR');
  }
  const task = updateTask(id, taskInput);
  if (!task) return jsonResponse(false, null, 'Task not found', 'NOT_FOUND');
  return jsonResponse(true, task, null, null, 'Task updated');
}

function handleDelete_(id) {
  if (!id) return jsonResponse(false, null, 'Missing id', 'VALIDATION_ERROR');
  const ok = deleteTask(id);
  if (!ok) return jsonResponse(false, null, 'Task not found', 'NOT_FOUND');
  return jsonResponse(true, { id: id }, null, null, 'Task deleted');
}

/* --------------------------------------------------------------------------
 * CORE DATA FUNCTIONS
 * ------------------------------------------------------------------------ */

/**
 * Reads all tasks, applies optional search/filter/sort, returns plain objects.
 * params: { search, status, priority, dueDate, sort }
 */
function getTasks(params) {
  params = params || {};
  const sheet = getSheet_();
  const values = sheet.getDataRange().getValues();
  values.shift(); // remove header row

  let tasks = values
    .filter(function (row) { return row[0] !== '' && row[0] !== null; })
    .map(rowToTask_);

  // --- search (Task, Notes, ID) ---
  if (params.search) {
    const q = String(params.search).toLowerCase().trim();
    if (q) {
      tasks = tasks.filter(function (t) {
        return (
          t.id.toLowerCase().indexOf(q) !== -1 ||
          t.task.toLowerCase().indexOf(q) !== -1 ||
          (t.notes || '').toLowerCase().indexOf(q) !== -1
        );
      });
    }
  }

  // --- filters ---
  if (params.status && params.status !== 'All') {
    tasks = tasks.filter(function (t) { return t.status === params.status; });
  }
  if (params.priority && params.priority !== 'All') {
    tasks = tasks.filter(function (t) { return t.priority === params.priority; });
  }
  if (params.dueDate === 'overdue') {
    const today = todayStr_();
    tasks = tasks.filter(function (t) {
      return t.dueDate && t.dueDate < today && t.status !== 'Completed';
    });
  } else if (params.dueDate === 'today') {
    const today = todayStr_();
    tasks = tasks.filter(function (t) { return t.dueDate === today; });
  } else if (params.dueDate === 'week') {
    const today = new Date();
    const weekOut = new Date();
    weekOut.setDate(today.getDate() + 7);
    const todayStr = todayStr_();
    const weekStr = Utilities.formatDate(weekOut, CONFIG.TIMEZONE, 'yyyy-MM-dd');
    tasks = tasks.filter(function (t) {
      return t.dueDate && t.dueDate >= todayStr && t.dueDate <= weekStr;
    });
  } else if (params.dueDate === 'none') {
    tasks = tasks.filter(function (t) { return !t.dueDate; });
  }

  // --- sort ---
  tasks = sortTasks_(tasks, params.sort);

  return tasks;
}

function createTask(input) {
  const sheet = getSheet_();
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const id = Utilities.getUuid();
    const now = nowIso_();
    const status = input.status || 'Not Started';
    const completedAt = status === 'Completed' ? now : '';

    const row = [
      id,
      sanitizeText_(input.task, LIMITS.TASK_MAX),
      normalizeDate_(input.dueDate),
      input.priority,
      status,
      sanitizeText_(input.notes || '', LIMITS.NOTES_MAX),
      now,
      now,
      completedAt,
    ];

    sheet.appendRow(row);
    return rowToTask_(row);
  } finally {
    lock.releaseLock();
  }
}

function updateTask(id, input) {
  const sheet = getSheet_();
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const found = findRowById_(sheet, id);
    if (!found) return null;

    const existing = rowToTask_(found.values);
    const now = nowIso_();

    const newStatus = input.status !== undefined ? input.status : existing.status;

    let completedAt = existing.completedAt;
    if (newStatus === 'Completed' && existing.status !== 'Completed') {
      completedAt = now; // just completed
    } else if (newStatus !== 'Completed' && existing.status === 'Completed') {
      completedAt = ''; // reopened
    }

    const updatedRow = [
      existing.id,
      input.task !== undefined ? sanitizeText_(input.task, LIMITS.TASK_MAX) : existing.task,
      input.dueDate !== undefined ? normalizeDate_(input.dueDate) : existing.dueDate,
      input.priority !== undefined ? input.priority : existing.priority,
      newStatus,
      input.notes !== undefined ? sanitizeText_(input.notes, LIMITS.NOTES_MAX) : existing.notes,
      existing.createdAt,
      now,
      completedAt,
    ];

    sheet.getRange(found.rowIndex, 1, 1, HEADERS.length).setValues([updatedRow]);
    return rowToTask_(updatedRow);
  } finally {
    lock.releaseLock();
  }
}

function deleteTask(id) {
  const sheet = getSheet_();
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const found = findRowById_(sheet, id);
    if (!found) return false;
    sheet.deleteRow(found.rowIndex);
    return true;
  } finally {
    lock.releaseLock();
  }
}

/* --------------------------------------------------------------------------
 * VALIDATION
 * ------------------------------------------------------------------------ */

/**
 * Validates a task payload.
 * @param {Object} data
 * @param {boolean} isUpdate - if true, fields are optional (partial update)
 * @returns {string[]} list of human-readable error messages (empty = valid)
 */
function validateTask(data, isUpdate) {
  const errors = [];

  if (!isUpdate || data.task !== undefined) {
    if (!data.task || typeof data.task !== 'string' || !data.task.trim()) {
      errors.push('Task title is required.');
    } else if (data.task.trim().length > LIMITS.TASK_MAX) {
      errors.push('Task title must be ' + LIMITS.TASK_MAX + ' characters or fewer.');
    }
  }

  if (!isUpdate || data.priority !== undefined) {
    if (!data.priority || PRIORITIES.indexOf(data.priority) === -1) {
      errors.push('Priority must be one of: ' + PRIORITIES.join(', ') + '.');
    }
  }

  if (data.status !== undefined && data.status !== null && data.status !== '') {
    if (STATUSES.indexOf(data.status) === -1) {
      errors.push('Status must be one of: ' + STATUSES.join(', ') + '.');
    }
  } else if (!isUpdate) {
    // status is optional on create (defaults to "Not Started")
  }

  if (data.dueDate !== undefined && data.dueDate !== null && data.dueDate !== '') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(data.dueDate))) {
      errors.push('Due date must be a valid date (YYYY-MM-DD).');
    } else {
      const d = new Date(data.dueDate + 'T00:00:00');
      if (isNaN(d.getTime())) errors.push('Due date is not a valid calendar date.');
    }
  }

  if (data.notes !== undefined && data.notes !== null) {
    if (typeof data.notes !== 'string') {
      errors.push('Notes must be text.');
    } else if (data.notes.length > LIMITS.NOTES_MAX) {
      errors.push('Notes must be ' + LIMITS.NOTES_MAX + ' characters or fewer.');
    }
  }

  return errors;
}

/* --------------------------------------------------------------------------
 * HELPERS
 * ------------------------------------------------------------------------ */

function getSheet_() {
  const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  let sheet = ss.getSheetByName(CONFIG.SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(CONFIG.SHEET_NAME);
  }
  ensureHeaders_(sheet);
  return sheet;
}

function ensureHeaders_(sheet) {
  const firstRow = sheet.getRange(1, 1, 1, HEADERS.length).getValues()[0];
  const hasHeaders = HEADERS.every(function (h, i) { return firstRow[i] === h; });
  if (!hasHeaders) {
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold');
  }
}

/**
 * Finds a row by ID. Returns { rowIndex (1-based, sheet coords), values } or null.
 */
function findRowById_(sheet, id) {
  const values = sheet.getDataRange().getValues();
  for (let i = 1; i < values.length; i++) {
    if (String(values[i][0]) === String(id)) {
      return { rowIndex: i + 1, values: values[i] };
    }
  }
  return null;
}

function rowToTask_(row) {
  return {
    id: String(row[0]),
    task: row[1] || '',
    dueDate: row[2] ? normalizeDate_(row[2]) : '',
    priority: row[3] || '',
    status: row[4] || '',
    notes: row[5] || '',
    createdAt: row[6] || '',
    updatedAt: row[7] || '',
    completedAt: row[8] || '',
  };
}

function sortTasks_(tasks, sortKey) {
  const cmp = {
    dueDate: function (a, b) {
      return (a.dueDate || '9999-99-99').localeCompare(b.dueDate || '9999-99-99');
    },
    priority: function (a, b) {
      const order = { High: 0, Medium: 1, Low: 2 };
      return order[a.priority] - order[b.priority];
    },
    newest: function (a, b) { return b.createdAt.localeCompare(a.createdAt); },
    oldest: function (a, b) { return a.createdAt.localeCompare(b.createdAt); },
    updated: function (a, b) { return b.updatedAt.localeCompare(a.updatedAt); },
    completed: function (a, b) {
      return (b.completedAt || '').localeCompare(a.completedAt || '');
    },
  };
  const fn = cmp[sortKey] || cmp.newest;
  return tasks.slice().sort(fn);
}

function sanitizeText_(text, maxLen) {
  if (text === null || text === undefined) return '';
  let t = String(text).trim();
  // Strip control characters and any raw HTML tags defensively.
  // (Rendering is also escaped client-side — this is defense in depth.)
  t = t.replace(/<[^>]*>/g, '');
  t = t.replace(/[\u0000-\u001F\u007F]/g, '');
  if (maxLen) t = t.substring(0, maxLen);
  return t;
}

function normalizeDate_(value) {
  if (!value) return '';
  if (value instanceof Date) {
    return Utilities.formatDate(value, CONFIG.TIMEZONE, 'yyyy-MM-dd');
  }
  const s = String(value).trim();
  const m = s.match(/^\d{4}-\d{2}-\d{2}/);
  return m ? m[0] : s;
}

function nowIso_() {
  return Utilities.formatDate(new Date(), CONFIG.TIMEZONE, "yyyy-MM-dd'T'HH:mm:ssXXX");
}

function todayStr_() {
  return Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'yyyy-MM-dd');
}

function getScriptProp_(key, fallback) {
  try {
    const v = PropertiesService.getScriptProperties().getProperty(key);
    return v || fallback;
  } catch (e) {
    return fallback;
  }
}

/**
 * Consistent JSON API response envelope.
 * { success, data, error, code, message }
 */
function jsonResponse(success, data, error, code, message) {
  const payload = {
    success: !!success,
    data: data !== undefined ? data : null,
    error: error || null,
    code: code || null,
    message: message || null,
    timestamp: nowIso_(),
  };
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * One-time setup helper — run manually from the Apps Script editor
 * (select "setup" in the function dropdown and click Run) to initialize
 * the sheet headers. Safe to re-run.
 */
function setup() {
  getSheet_();
  Logger.log('Sheet "%s" is ready.', CONFIG.SHEET_NAME);
}
