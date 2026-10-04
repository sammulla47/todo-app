/**
 * app.js — application controller. Owns state, talks to Api, and tells
 * UI what to render. No direct DOM manipulation happens here beyond
 * reading form values.
 */

(function () {
  'use strict';

  const state = {
    tasks: [],
    loading: false,
    error: null,
    filters: {
      search: '',
      status: 'All',
      priority: 'All',
      dueDate: 'All',
      sort: 'dueDate',
    },
    editingId: null, // task currently open in modal (null = creating)
  };

  let debounceTimer = null;

  document.addEventListener('DOMContentLoaded', init);

  function init() {
    UI.init();
    bindEvents();
    loadTasks();
  }

  /* ------------------------------- Data flow ------------------------------- */

  async function loadTasks() {
    state.loading = true;
    state.error = null;
    UI.renderLoading();
    try {
      const tasks = await Api.listTasks(state.filters);
      state.tasks = tasks;
      state.loading = false;
      renderAll();
    } catch (err) {
      state.loading = false;
      state.error = err.message || 'Something went wrong.';
      UI.renderDashboard([]);
      UI.renderError(state.error, loadTasks);
      UI.showToast(state.error, 'error');
    }
  }

  function renderAll() {
    UI.renderDashboard(state.tasks);
    const hasFilters =
      !!state.filters.search ||
      state.filters.status !== 'All' ||
      state.filters.priority !== 'All' ||
      state.filters.dueDate !== 'All';

    if (!state.tasks.length) {
      UI.renderEmpty(hasFilters);
    } else {
      UI.renderTaskList(state.tasks);
    }
  }

  /* -------------------------------- Events -------------------------------- */

  function bindEvents() {
    const els = UI.els;

    els.addTaskBtn.addEventListener('click', () => {
      state.editingId = null;
      UI.openTaskModal(null);
    });

    els.modalCloseBtn.addEventListener('click', UI.closeTaskModal);
    els.modalCancelBtn.addEventListener('click', UI.closeTaskModal);
    els.modalOverlay.addEventListener('click', (e) => {
      if (e.target === els.modalOverlay) UI.closeTaskModal();
    });

    els.taskForm.addEventListener('submit', onSubmitTask);

    els.taskList.addEventListener('click', onTaskListClick);
    els.taskList.addEventListener('change', onTaskListChange);
    els.taskList.addEventListener('keydown', onTaskListKeydown);

    els.searchInput.addEventListener('input', (e) => {
      clearTimeout(debounceTimer);
      const value = e.target.value;
      debounceTimer = setTimeout(() => {
        state.filters.search = value.trim();
        loadTasks();
      }, 350);
    });

    els.filterStatus.addEventListener('change', (e) => {
      state.filters.status = e.target.value;
      loadTasks();
    });
    els.filterPriority.addEventListener('change', (e) => {
      state.filters.priority = e.target.value;
      loadTasks();
    });
    els.filterDueDate.addEventListener('change', (e) => {
      state.filters.dueDate = e.target.value;
      loadTasks();
    });
    els.sortSelect.addEventListener('change', (e) => {
      state.filters.sort = e.target.value;
      loadTasks();
    });

    els.clearFiltersBtn.addEventListener('click', () => {
      state.filters = { search: '', status: 'All', priority: 'All', dueDate: 'All', sort: 'dueDate' };
      els.searchInput.value = '';
      els.filterStatus.value = 'All';
      els.filterPriority.value = 'All';
      els.filterDueDate.value = 'All';
      els.sortSelect.value = 'dueDate';
      loadTasks();
    });

    els.confirmCancelBtn.addEventListener('click', () => UI.resolveConfirm(false));
    els.confirmOkBtn.addEventListener('click', () => UI.resolveConfirm(true));
    els.confirmOverlay.addEventListener('click', (e) => {
      if (e.target === els.confirmOverlay) UI.resolveConfirm(false);
    });
  }

  function onTaskListKeydown(e) {
    // Allow opening a task card for edit via Enter when it (not a button) has focus
    if (e.key === 'Enter' && e.target.classList.contains('task-card')) {
      const id = e.target.dataset.id;
      const task = state.tasks.find((t) => t.id === id);
      if (task) {
        state.editingId = task.id;
        UI.openTaskModal(task);
      }
    }
  }

  function onTaskListClick(e) {
    const editBtn = e.target.closest('.edit-btn');
    const deleteBtn = e.target.closest('.delete-btn');
    const card = e.target.closest('.task-card');

    if (editBtn) {
      const task = state.tasks.find((t) => t.id === editBtn.dataset.id);
      if (task) {
        state.editingId = task.id;
        UI.openTaskModal(task);
      }
      return;
    }

    if (deleteBtn) {
      handleDelete(deleteBtn.dataset.id);
      return;
    }

    // Click on the card body (not the checkbox / buttons) opens edit
    if (card && !e.target.closest('.task-checkbox') && !e.target.closest('.task-actions')) {
      const task = state.tasks.find((t) => t.id === card.dataset.id);
      if (task) {
        state.editingId = task.id;
        UI.openTaskModal(task);
      }
    }
  }

  function onTaskListChange(e) {
    if (e.target.classList.contains('complete-toggle')) {
      const id = e.target.dataset.id;
      const checked = e.target.checked;
      handleToggleComplete(id, checked, e.target);
    }
  }

  /* ------------------------------- Actions ------------------------------- */

  async function onSubmitTask(e) {
    e.preventDefault();
    const form = e.target;
    const data = {
      task: form.elements['task'].value,
      dueDate: form.elements['dueDate'].value,
      priority: form.elements['priority'].value,
      status: form.elements['status'].value,
      notes: form.elements['notes'].value,
    };

    const { valid, errors } = validateTaskForm(data);
    if (!valid) {
      UI.showFormErrors(errors);
      return;
    }

    UI.setSaving(true);
    try {
      if (state.editingId) {
        const updated = await Api.updateTask(state.editingId, data);
        const idx = state.tasks.findIndex((t) => t.id === state.editingId);
        if (idx !== -1) state.tasks[idx] = updated;
        UI.showToast('Task updated.', 'success');
      } else {
        const created = await Api.createTask(data);
        state.tasks.unshift(created);
        UI.showToast('Task created.', 'success');
      }
      UI.closeTaskModal();
      applyClientFiltersAndRender();
    } catch (err) {
      UI.showToast(err.message || 'Could not save task.', 'error');
    } finally {
      UI.setSaving(false);
    }
  }

  async function handleDelete(id) {
    const task = state.tasks.find((t) => t.id === id);
    if (!task) return;
    const confirmed = await UI.openConfirm(`Delete "${task.task}"? This cannot be undone.`);
    if (!confirmed) return;

    try {
      await Api.deleteTask(id);
      state.tasks = state.tasks.filter((t) => t.id !== id);
      UI.showToast('Task deleted.', 'success');
      renderAll();
    } catch (err) {
      UI.showToast(err.message || 'Could not delete task.', 'error');
    }
  }

  async function handleToggleComplete(id, checked, checkboxEl) {
    const task = state.tasks.find((t) => t.id === id);
    if (!task) return;
    const newStatus = checked ? 'Completed' : 'Not Started';

    checkboxEl.disabled = true;
    try {
      const updated = await Api.updateTask(id, { status: newStatus });
      const idx = state.tasks.findIndex((t) => t.id === id);
      if (idx !== -1) state.tasks[idx] = updated;
      UI.showToast(checked ? 'Task marked complete.' : 'Task reopened.', 'success');
      renderAll();
    } catch (err) {
      checkboxEl.checked = !checked; // revert
      UI.showToast(err.message || 'Could not update task.', 'error');
    } finally {
      checkboxEl.disabled = false;
    }
  }

  function applyClientFiltersAndRender() {
    // After create/update we already have the authoritative list in
    // memory; a full reload keeps filters/sort consistent server-side.
    loadTasks();
  }
})();
