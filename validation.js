/**
 * validation.js — client-side validation mirroring the backend rules in
 * Code.gs (validateTask). This gives instant feedback in the UI; the
 * server always re-validates independently and is the source of truth.
 */

const VALIDATION_RULES = Object.freeze({
  PRIORITIES: ['High', 'Medium', 'Low'],
  STATUSES: ['Not Started', 'In Progress', 'On Hold', 'Completed'],
  TASK_MAX: 200,
  NOTES_MAX: 2000,
});

/**
 * Validates a task form payload.
 * @param {{task:string, dueDate:string, priority:string, status:string, notes:string}} data
 * @returns {{valid:boolean, errors:Object<string,string>}} field-keyed error map
 */
function validateTaskForm(data) {
  const errors = {};

  const task = (data.task || '').trim();
  if (!task) {
    errors.task = 'Task title is required.';
  } else if (task.length > VALIDATION_RULES.TASK_MAX) {
    errors.task = `Task title must be ${VALIDATION_RULES.TASK_MAX} characters or fewer.`;
  }

  if (!data.priority || VALIDATION_RULES.PRIORITIES.indexOf(data.priority) === -1) {
    errors.priority = 'Select a priority.';
  }

  if (data.status && VALIDATION_RULES.STATUSES.indexOf(data.status) === -1) {
    errors.status = 'Select a valid status.';
  }

  if (data.dueDate) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data.dueDate)) {
      errors.dueDate = 'Enter a valid date.';
    } else {
      const d = new Date(data.dueDate + 'T00:00:00');
      if (isNaN(d.getTime())) errors.dueDate = 'Enter a valid calendar date.';
    }
  }

  const notes = data.notes || '';
  if (notes.length > VALIDATION_RULES.NOTES_MAX) {
    errors.notes = `Notes must be ${VALIDATION_RULES.NOTES_MAX} characters or fewer.`;
  }

  return { valid: Object.keys(errors).length === 0, errors };
}

/**
 * Escapes text for safe injection into HTML strings.
 * Used everywhere task data is templated into innerHTML, as defense in
 * depth alongside preferring textContent where possible.
 */
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
