/**
 * ui.js — all DOM rendering and presentational logic. No fetch calls here;
 * app.js owns data flow and calls into these functions to reflect state.
 */

const UI = (() => {
  const els = {}; // populated in init()

  function init() {
    els.dashboard = document.getElementById('dashboard');
    els.taskList = document.getElementById('task-list');
    els.taskListState = document.getElementById('task-list-state');
    els.toastContainer = document.getElementById('toast-container');

    els.searchInput = document.getElementById('search-input');
    els.filterStatus = document.getElementById('filter-status');
    els.filterPriority = document.getElementById('filter-priority');
    els.filterDueDate = document.getElementById('filter-due-date');
    els.sortSelect = document.getElementById('sort-select');
    els.clearFiltersBtn = document.getElementById('clear-filters-btn');

    els.addTaskBtn = document.getElementById('add-task-btn');
    els.modalOverlay = document.getElementById('modal-overlay');
    els.taskModal = document.getElementById('task-modal');
    els.taskForm = document.getElementById('task-form');
    els.modalTitle = document.getElementById('modal-title');
    els.modalCloseBtn = document.getElementById('modal-close-btn');
    els.modalCancelBtn = document.getElementById('modal-cancel-btn');
    els.modalSaveBtn = document.getElementById('modal-save-btn');

    els.confirmOverlay = document.getElementById('confirm-overlay');
    els.confirmModal = document.getElementById('confirm-modal');
    els.confirmMessage = document.getElementById('confirm-message');
    els.confirmOkBtn = document.getElementById('confirm-ok-btn');
    els.confirmCancelBtn = document.getElementById('confirm-cancel-btn');

    return els;
  }

  /* ---------------------------- Dashboard ---------------------------- */

  function computeCounts(tasks) {
    const today = todayStr();
    const counts = {
      total: tasks.length,
      pending: 0,
      inProgress: 0,
      onHold: 0,
      completed: 0,
      overdue: 0,
    };
    tasks.forEach((t) => {
      if (t.status === 'Not Started') counts.pending++;
      else if (t.status === 'In Progress') counts.inProgress++;
      else if (t.status === 'On Hold') counts.onHold++;
      else if (t.status === 'Completed') counts.completed++;

      if (t.dueDate && t.dueDate < today && t.status !== 'Completed') counts.overdue++;
    });
    return counts;
  }

  function renderDashboard(tasks) {
    const c = computeCounts(tasks);
    const cards = [
      { label: 'Total', value: c.total, key: 'total' },
      { label: 'Pending', value: c.pending, key: 'pending' },
      { label: 'In Progress', value: c.inProgress, key: 'in-progress' },
      { label: 'On Hold', value: c.onHold, key: 'on-hold' },
      { label: 'Completed', value: c.completed, key: 'completed' },
      { label: 'Overdue', value: c.overdue, key: 'overdue' },
    ];
    els.dashboard.innerHTML = cards
      .map(
        (c) => `
      <div class="stat-card stat-${c.key}" role="status" aria-label="${c.label}: ${c.value}">
        <span class="stat-value">${c.value}</span>
        <span class="stat-label">${c.label}</span>
      </div>`
      )
      .join('');
  }

  /* ------------------------------ States ------------------------------ */

  function renderLoading() {
    els.taskListState.innerHTML = `
      <div class="state-panel" role="status" aria-live="polite">
        <div class="spinner" aria-hidden="true"></div>
        <p>Loading tasks…</p>
      </div>`;
    els.taskListState.hidden = false;
    els.taskList.hidden = true;
  }

  function renderError(message, onRetry) {
    els.taskListState.innerHTML = `
      <div class="state-panel state-error" role="alert">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="1.6"/>
          <path d="M12 7v6M12 16.5v.01" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
        </svg>
        <p>${escapeHtml(message)}</p>
        <button type="button" class="btn btn-secondary" id="retry-btn">Try again</button>
      </div>`;
    els.taskListState.hidden = false;
    els.taskList.hidden = true;
    const retryBtn = document.getElementById('retry-btn');
    if (retryBtn && onRetry) retryBtn.addEventListener('click', onRetry);
  }

  function renderEmpty(hasActiveFilters) {
    els.taskListState.innerHTML = `
      <div class="state-panel">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <rect x="4" y="4" width="16" height="16" rx="3" stroke="currentColor" stroke-width="1.4"/>
          <path d="M8 12h8M8 16h5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
        </svg>
        <p>${hasActiveFilters ? 'No tasks match your filters.' : 'No tasks yet — add your first one.'}</p>
        ${hasActiveFilters ? '<button type="button" class="btn btn-secondary" id="empty-clear-btn">Clear filters</button>' : ''}
      </div>`;
    els.taskListState.hidden = false;
    els.taskList.hidden = true;
    const clearBtn = document.getElementById('empty-clear-btn');
    if (clearBtn) clearBtn.addEventListener('click', () => els.clearFiltersBtn.click());
  }

  /* ----------------------------- Task list ----------------------------- */

  const PRIORITY_CLASS = { High: 'priority-high', Medium: 'priority-medium', Low: 'priority-low' };
  const STATUS_CLASS = {
    'Not Started': 'status-not-started',
    'In Progress': 'status-in-progress',
    'On Hold': 'status-on-hold',
    Completed: 'status-completed',
  };

  function todayStr() {
    const d = new Date();
    return d.toISOString().slice(0, 10);
  }

  function isOverdue(task) {
    return !!task.dueDate && task.dueDate < todayStr() && task.status !== 'Completed';
  }

  function formatDate(iso) {
    if (!iso) return '—';
    const [y, m, d] = iso.split('-');
    if (!y) return escapeHtml(iso);
    const date = new Date(Number(y), Number(m) - 1, Number(d));
    return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  }

  function formatDateTime(iso) {
    if (!iso) return '—';
    const date = new Date(iso);
    if (isNaN(date.getTime())) return escapeHtml(iso);
    return date.toLocaleString(undefined, {
      day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  }

  function taskCardHtml(task) {
    const overdue = isOverdue(task);
    return `
    <article class="task-card ${overdue ? 'is-overdue' : ''}" data-id="${escapeHtml(task.id)}" tabindex="0" aria-label="Task: ${escapeHtml(task.task)}">
      <header class="task-card-header">
        <label class="task-checkbox">
          <input type="checkbox" class="complete-toggle" ${task.status === 'Completed' ? 'checked' : ''}
            aria-label="Mark '${escapeHtml(task.task)}' as complete" data-id="${escapeHtml(task.id)}" />
          <span class="checkmark" aria-hidden="true"></span>
        </label>
        <h3 class="task-title ${task.status === 'Completed' ? 'is-done' : ''}">${escapeHtml(task.task)}</h3>
      </header>

      <div class="task-meta">
        <span class="badge ${PRIORITY_CLASS[task.priority] || ''}">${escapeHtml(task.priority)}</span>
        <span class="badge ${STATUS_CLASS[task.status] || ''}">${escapeHtml(task.status)}</span>
        <span class="due-date ${overdue ? 'overdue-text' : ''}">
          ${overdue ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2"/><path d="M12 7v6M12 16.5v.01" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>' : ''}
          Due ${formatDate(task.dueDate)}
        </span>
      </div>

      ${task.notes ? `<p class="task-notes">${escapeHtml(truncate(task.notes, 140))}</p>` : ''}

      <footer class="task-card-footer">
        <span class="task-timestamp" title="Created ${formatDateTime(task.createdAt)}">Created ${formatDate(task.createdAt.slice(0,10))}</span>
        <span class="task-id" title="Task ID">#${escapeHtml(task.id.slice(0, 8))}</span>
        <div class="task-actions">
          <button type="button" class="icon-btn edit-btn" data-id="${escapeHtml(task.id)}" aria-label="Edit task ${escapeHtml(task.task)}">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 20h4l10-10-4-4L4 16v4Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>
          </button>
          <button type="button" class="icon-btn delete-btn" data-id="${escapeHtml(task.id)}" aria-label="Delete task ${escapeHtml(task.task)}">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 7h14M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2m-8 0 1 13a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2l1-13" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
        </div>
      </footer>
    </article>`;
  }

  function truncate(str, n) {
    return str.length > n ? str.slice(0, n - 1) + '…' : str;
  }

  function renderTaskList(tasks) {
    if (!tasks.length) {
      renderEmpty(false);
      return;
    }
    els.taskListState.hidden = true;
    els.taskList.hidden = false;
    els.taskList.innerHTML = tasks.map(taskCardHtml).join('');
  }

  /* ------------------------------- Toasts ------------------------------- */

  function showToast(message, type = 'info', timeout = 3800) {
    const id = 'toast-' + Date.now() + Math.random().toString(36).slice(2, 7);
    const icon = {
      success: '<path d="M5 13l4 4L19 7" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>',
      error: '<path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>',
      info: '<circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.8"/><path d="M12 11v5M12 8v.01" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
    }[type] || '';

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.id = id;
    toast.setAttribute('role', 'status');
    toast.innerHTML = `
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">${icon}</svg>
      <span class="toast-message">${escapeHtml(message)}</span>
      <button type="button" class="toast-close" aria-label="Dismiss notification">&times;</button>`;

    els.toastContainer.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('toast-visible'));

    const remove = () => {
      toast.classList.remove('toast-visible');
      setTimeout(() => toast.remove(), 200);
    };
    toast.querySelector('.toast-close').addEventListener('click', remove);
    if (timeout) setTimeout(remove, timeout);
  }

  /* -------------------------------- Modal -------------------------------- */

  let lastFocusedEl = null;

  function openTaskModal(task) {
    lastFocusedEl = document.activeElement;
    els.modalTitle.textContent = task ? 'Edit Task' : 'Add New Task';
    els.taskForm.reset();
    clearFormErrors();

    els.taskForm.elements['id'].value = task ? task.id : '';
    els.taskForm.elements['task'].value = task ? task.task : '';
    els.taskForm.elements['dueDate'].value = task ? task.dueDate : '';
    els.taskForm.elements['priority'].value = task ? task.priority : 'Medium';
    els.taskForm.elements['status'].value = task ? task.status : 'Not Started';
    els.taskForm.elements['notes'].value = task ? task.notes : '';

    els.modalOverlay.hidden = false;
    document.body.classList.add('modal-open');
    trapFocus(els.taskModal);
    els.taskForm.elements['task'].focus();
    document.addEventListener('keydown', onModalKeydown);
  }

  function closeTaskModal() {
    els.modalOverlay.hidden = true;
    document.body.classList.remove('modal-open');
    document.removeEventListener('keydown', onModalKeydown);
    if (lastFocusedEl) lastFocusedEl.focus();
  }

  function onModalKeydown(e) {
    if (e.key === 'Escape') closeTaskModal();
  }

  function trapFocus(container) {
    const focusable = container.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    container.onkeydown = (e) => {
      if (e.key !== 'Tab') return;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
  }

  function showFormErrors(errors) {
    clearFormErrors();
    Object.keys(errors).forEach((field) => {
      const input = els.taskForm.elements[field];
      const errorEl = document.getElementById('error-' + field);
      if (input) input.setAttribute('aria-invalid', 'true');
      if (errorEl) errorEl.textContent = errors[field];
    });
  }

  function clearFormErrors() {
    els.taskForm.querySelectorAll('.field-error').forEach((el) => (el.textContent = ''));
    els.taskForm.querySelectorAll('[aria-invalid]').forEach((el) => el.removeAttribute('aria-invalid'));
  }

  function setSaving(isSaving) {
    els.modalSaveBtn.disabled = isSaving;
    els.modalSaveBtn.textContent = isSaving ? 'Saving…' : 'Save Task';
  }

  /* ----------------------------- Confirm modal ----------------------------- */

  let confirmResolver = null;

  function openConfirm(message) {
    els.confirmMessage.textContent = message;
    els.confirmOverlay.hidden = false;
    document.body.classList.add('modal-open');
    trapFocus(els.confirmModal);
    els.confirmCancelBtn.focus();
    return new Promise((resolve) => {
      confirmResolver = resolve;
    });
  }

  function resolveConfirm(result) {
    els.confirmOverlay.hidden = true;
    document.body.classList.remove('modal-open');
    if (confirmResolver) {
      confirmResolver(result);
      confirmResolver = null;
    }
  }

  return {
    init,
    renderDashboard,
    renderLoading,
    renderError,
    renderEmpty,
    renderTaskList,
    showToast,
    openTaskModal,
    closeTaskModal,
    showFormErrors,
    clearFormErrors,
    setSaving,
    openConfirm,
    resolveConfirm,
    get els() {
      return els;
    },
  };
})();
