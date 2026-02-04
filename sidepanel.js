// Side panel logic for Flow Run Buddy

(function () {
  'use strict';

  // DOM elements
  const loadingEl = document.getElementById('loading');
  const noFlowEl = document.getElementById('no-flow');
  const errorEl = document.getElementById('error');
  const errorMessageEl = document.getElementById('error-message');
  const runsListEl = document.getElementById('runs-list');
  const noRunsEl = document.getElementById('no-runs');
  const powerAppsRedirectEl = document.getElementById('powerapps-redirect');
  const openInPowerAutomateBtn = document.getElementById('open-in-powerautomate');
  const refreshBtn = document.getElementById('refresh-btn');
  const retryBtn = document.getElementById('retry-btn');
  const backToEditorEl = document.getElementById('back-to-editor');
  const backBtn = document.getElementById('back-btn');
  const themeToggleBtn = document.getElementById('theme-toggle');

  // Current state
  let currentContext = null;
  let currentTabId = null;
  let isLoading = false;
  let flowEditorUrl = null; // Store the flow editor URL to return to
  let currentTheme = 'light';

  // Theme helpers
  function applyTheme(theme) {
    currentTheme = theme === 'dark' ? 'dark' : 'light';

    if (currentTheme === 'dark') {
      document.body.classList.add('dark-theme');
      if (themeToggleBtn) {
        themeToggleBtn.title = 'Switch to light mode';
      }
    } else {
      document.body.classList.remove('dark-theme');
      if (themeToggleBtn) {
        themeToggleBtn.title = 'Switch to dark mode';
      }
    }

    try {
      chrome.storage?.sync?.set({ theme: currentTheme });
    } catch (e) {
      // Ignore storage errors
    }
  }

  function loadThemePreference() {
    try {
      chrome.storage?.sync?.get(['theme'], (result) => {
        if (chrome.runtime.lastError) {
          applyTheme('light');
          return;
        }
        const saved = result && typeof result.theme === 'string' ? result.theme : 'light';
        applyTheme(saved);
      });
    } catch (e) {
      applyTheme('light');
    }
  }

  // Show a specific state
  function showState(state) {
    loadingEl.classList.add('hidden');
    noFlowEl.classList.add('hidden');
    errorEl.classList.add('hidden');
    runsListEl.classList.add('hidden');
    noRunsEl.classList.add('hidden');
    powerAppsRedirectEl.classList.add('hidden');

    state.classList.remove('hidden');
  }

  // Open flow in Power Automate
  function openInPowerAutomate() {
    if (!currentContext || !currentTabId) return;
    const { environmentId, flowId } = currentContext;
    const url = `https://make.powerautomate.com/environments/${environmentId}/flows/${flowId}`;
    chrome.tabs.update(currentTabId, { url: url });
  }

  // Format relative time
  function formatRelativeTime(dateString) {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now - date;
    const diffSecs = Math.floor(diffMs / 1000);
    const diffMins = Math.floor(diffSecs / 60);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffSecs < 60) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;

    return date.toLocaleDateString();
  }

  // Format duration
  function formatDuration(startTime, endTime) {
    if (!startTime || !endTime) return null;

    const start = new Date(startTime);
    const end = new Date(endTime);
    const diffMs = end - start;

    if (diffMs < 0) return null;

    const diffSecs = Math.floor(diffMs / 1000);
    const diffMins = Math.floor(diffSecs / 60);
    const remainingSecs = diffSecs % 60;

    if (diffMins === 0) return `${diffSecs}s`;
    if (diffMins < 60) return `${diffMins}m ${remainingSecs}s`;

    const diffHours = Math.floor(diffMins / 60);
    const remainingMins = diffMins % 60;
    return `${diffHours}h ${remainingMins}m`;
  }

  // Get status info
  function getStatusInfo(status) {
    const statusLower = (status || '').toLowerCase();

    switch (statusLower) {
      case 'succeeded':
        return { icon: '✓', class: 'succeeded', label: 'Succeeded' };
      case 'failed':
        return { icon: '✕', class: 'failed', label: 'Failed' };
      case 'cancelled':
        return { icon: '—', class: 'cancelled', label: 'Cancelled' };
      case 'running':
        return { icon: '●', class: 'running', label: 'Running' };
      default:
        return { icon: '?', class: 'cancelled', label: status || 'Unknown' };
    }
  }

  // Extract a useful run-level error message
  function getRunError(run) {
    const error = run?.properties?.error;
    if (!error) return null;

    if (typeof error.message === 'string' && error.message.trim()) {
      return error.message.trim();
    }

    if (Array.isArray(error.details) && error.details[0]?.message) {
      return String(error.details[0].message).trim();
    }

    return null;
  }

  // Cache for loaded actions
  const actionsCache = new Map();
  // Cache for runs by id (name)
  let runsById = new Map();

  // Render runs list
  function renderRuns(runs) {
    if (!runs || runs.length === 0) {
      showState(noRunsEl);
      return;
    }

    runsListEl.innerHTML = runs.map(run => {
      const status = getStatusInfo(run.properties?.status);
      const startTime = run.properties?.startTime;
      const endTime = run.properties?.endTime;
      const duration = formatDuration(startTime, endTime);
      const runId = run.name;
      const isRunning = status.class === 'running';

      return `
        <div class="run-container" data-run-id="${runId}">
          <div class="run-item">
            <button class="expand-btn" title="Show steps">
              <svg class="expand-icon" width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                <path d="M4 6l4 4 4-4"/>
              </svg>
            </button>
            <div class="status-icon ${status.class}" title="${status.label}">
              ${status.icon}
            </div>
            <div class="run-details">
              <div class="run-time">${formatRelativeTime(startTime)}</div>
              <div class="run-meta">
                <span class="run-status">${status.label}</span>
                ${duration ? `<span class="run-duration">· ${duration}</span>` : ''}
              </div>
            </div>
            ${isRunning ? `
              <button class="cancel-btn" title="Cancel run">
                <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="2" fill="none"/>
                </svg>
              </button>
            ` : ''}
            <button class="open-btn" title="Open run details">
              <svg class="chevron" width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                <path d="M6 4l4 4-4 4"/>
              </svg>
            </button>
          </div>
          <div class="actions-container hidden">
            <div class="actions-loading">
              <div class="spinner-small"></div>
              Loading steps...
            </div>
          </div>
        </div>
      `;
    }).join('');

    // Add click handlers for expand buttons
    runsListEl.querySelectorAll('.expand-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const container = btn.closest('.run-container');
        const runId = container.dataset.runId;
        toggleExpand(container, runId);
      });
    });

    // Add click handlers for open buttons
    runsListEl.querySelectorAll('.open-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const container = btn.closest('.run-container');
        const runId = container.dataset.runId;
        openRun(runId);
      });
    });

    // Add double-click handler on run items to open run details
    runsListEl.querySelectorAll('.run-item').forEach(item => {
      item.addEventListener('dblclick', (e) => {
        // Ignore if clicking on expand button
        if (e.target.closest('.expand-btn')) return;

        const container = item.closest('.run-container');
        const runId = container.dataset.runId;
        openRun(runId);
      });
    });

    // Add click handlers for cancel buttons
    runsListEl.querySelectorAll('.cancel-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const container = btn.closest('.run-container');
        const runId = container.dataset.runId;
        cancelRun(runId, btn);
      });
    });

    showState(runsListEl);
  }

  // Cancel a running flow
  async function cancelRun(runId, btn) {
    if (!currentContext || !currentTabId) return;

    // Disable button and show loading state
    btn.disabled = true;
    btn.classList.add('cancelling');
    btn.innerHTML = '<div class="spinner-tiny"></div>';

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'CANCEL_RUN',
        environmentId: currentContext.environmentId,
        flowId: currentContext.flowId,
        runId: runId,
        tabId: currentTabId
      });

      if (response && response.success) {
        // Refresh the runs list to show updated status
        actionsCache.delete(runId);
        await loadRuns();
      } else {
        // Re-enable button on error
        btn.disabled = false;
        btn.classList.remove('cancelling');
        btn.innerHTML = `
          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
            <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="2" fill="none"/>
          </svg>
        `;
        alert(response?.error || 'Failed to cancel run');
      }
    } catch (error) {
      btn.disabled = false;
      btn.classList.remove('cancelling');
      btn.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
          <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="2" fill="none"/>
        </svg>
      `;
      alert(error.message || 'Failed to cancel run');
    }
  }

  // Toggle expand/collapse for a run
  async function toggleExpand(container, runId) {
    const actionsContainer = container.querySelector('.actions-container');
    const expandIcon = container.querySelector('.expand-icon');
    const isExpanded = container.classList.contains('expanded');

    if (isExpanded) {
      // Collapse
      container.classList.remove('expanded');
      actionsContainer.classList.add('hidden');
      expandIcon.style.transform = '';
    } else {
      // Expand
      container.classList.add('expanded');
      actionsContainer.classList.remove('hidden');
      expandIcon.style.transform = 'rotate(-180deg)';

      const run = runsById.get(runId);
      const runError = getRunError(run);

      // Load actions if not cached
      if (!actionsCache.has(runId)) {
        await loadActions(container, runId, runError);
      } else {
        renderActions(actionsContainer, actionsCache.get(runId), runError);
      }
    }
  }

  // Load actions for a run
  async function loadActions(container, runId, runError) {
    const actionsContainer = container.querySelector('.actions-container');

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'FETCH_RUN_ACTIONS',
        environmentId: currentContext.environmentId,
        flowId: currentContext.flowId,
        runId: runId,
        tabId: currentTabId
      });

      if (response && response.success) {
        actionsCache.set(runId, response.actions);
        renderActions(actionsContainer, response.actions, runError);
      } else {
        actionsContainer.innerHTML = `
          <div class="actions-error">
            Failed to load steps
          </div>
        `;
      }
    } catch (error) {
      actionsContainer.innerHTML = `
        <div class="actions-error">
          Failed to load steps
        </div>
      `;
    }
  }

  // Render actions list
  function renderActions(container, actions, runError) {
    if (!actions || actions.length === 0) {
      container.innerHTML = '<div class="actions-empty">No steps found</div>';
      return;
    }

    const headerHtml = runError ? `
      <div class="actions-run-error" title="${runError}">
        ${runError}
      </div>
    ` : '';

    const actionsHtml = actions.map(action => {
      const status = getStatusInfo(action.status);
      const errorMessage = action.error?.message || action.error?.details?.[0]?.message;
      return `
        <div class="action-item">
          <div class="action-status ${status.class}">${status.icon}</div>
          <div class="action-main">
            <div class="action-name">${action.name}</div>
            ${status.class === 'failed' && errorMessage ? `
              <div class="action-error" title="${errorMessage}">
                ${errorMessage}
              </div>
            ` : ''}
          </div>
        </div>
      `;
    }).join('');

    container.innerHTML = headerHtml + actionsHtml;
  }

  // Check if current URL is a run page (not the editor)
  function isRunPage(url) {
    return url && url.includes('/runs/');
  }

  // Derive flow context directly from a tab URL
  function extractContextFromUrl(urlString) {
    try {
      if (!urlString) return null;

      const url = new URL(urlString);
      const origin = url.origin;
      const isPowerApps = origin.includes('powerapps.com');

      const envMatch = url.pathname.match(/\/environments\/([^/]+)/);
      if (!envMatch) return null;
      const environmentId = envMatch[1];

      let flowId = null;
      let flowMatch = url.pathname.match(/\/flows\/([^/?]+)/);
      if (!flowMatch) {
        flowMatch = url.pathname.match(/\/objects\/cloudflows\/([^/?]+)/);
      }

      if (flowMatch) {
        flowId = flowMatch[1];
      }

      if (!flowId) return null;

      return {
        environmentId,
        flowId,
        origin,
        url: urlString,
        isPowerApps
      };
    } catch (e) {
      return null;
    }
  }

  // Get the flow editor URL from context
  function getFlowEditorUrl(context) {
    if (!context) return null;
    const { environmentId, flowId, origin } = context;
    const baseUrl = origin || 'https://make.powerautomate.com';
    return `${baseUrl}/environments/${environmentId}/flows/${flowId}`;
  }

  // Update back button visibility - always show when we have a flow context
  function updateBackButton() {
    if (flowEditorUrl && currentContext) {
      backToEditorEl.classList.remove('hidden');
    } else {
      backToEditorEl.classList.add('hidden');
    }
  }

  // Open run in current tab
  function openRun(runId) {
    if (!currentContext) return;

    const { environmentId, flowId, origin } = currentContext;
    const baseUrl = origin || 'https://make.powerautomate.com';
    const runUrl = `${baseUrl}/environments/${environmentId}/flows/${flowId}/runs/${runId}`;

    chrome.tabs.update(currentTabId, { url: runUrl });
  }

  // Return to flow editor
  function returnToEditor() {
    if (flowEditorUrl && currentTabId) {
      chrome.tabs.update(currentTabId, { url: flowEditorUrl });
    }
  }

  // Fetch runs via background script
  async function loadRuns() {
    if (!currentContext || !currentTabId || isLoading) return;

    isLoading = true;
    refreshBtn.classList.add('spinning');
    showState(loadingEl);

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'FETCH_RUNS',
        environmentId: currentContext.environmentId,
        flowId: currentContext.flowId,
        tabId: currentTabId
      });

      if (response && response.success) {
        runsById = new Map(response.runs.map(run => [run.name, run]));
        renderRuns(response.runs);
      } else {
        errorMessageEl.textContent = response?.error || 'Failed to load runs';
        showState(errorEl);
      }
    } catch (error) {
      errorMessageEl.textContent = error.message || 'Failed to load runs';
      showState(errorEl);
    } finally {
      isLoading = false;
      refreshBtn.classList.remove('spinning');
    }
  }

  // Get current tab and context
  async function init() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab) {
        showState(noFlowEl);
        return;
      }

      currentTabId = tab.id;

      // Get context from background
      const context = await chrome.runtime.sendMessage({
        type: 'GET_CONTEXT_FOR_TAB',
        tabId: tab.id
      });

      if (context) {
        currentContext = context;
        // Check if on Power Apps - show redirect message
        if (context.isPowerApps) {
          backToEditorEl.classList.add('hidden');
          showState(powerAppsRedirectEl);
          return;
        }
        // Always store/update the editor URL from context
        flowEditorUrl = getFlowEditorUrl(context);
        updateBackButton();
        loadRuns();
      } else {
        // Fallback: derive context directly from the active tab URL
        const urlContext = extractContextFromUrl(tab.url);
        if (urlContext) {
          currentContext = urlContext;
          if (urlContext.isPowerApps) {
            backToEditorEl.classList.add('hidden');
            showState(powerAppsRedirectEl);
            return;
          }
          flowEditorUrl = getFlowEditorUrl(urlContext);
          updateBackButton();
          loadRuns();
        } else {
          showState(noFlowEl);
        }
      }
    } catch (error) {
      showState(noFlowEl);
    }
  }

  // Listen for context updates
  chrome.runtime.onMessage.addListener((message) => {
    // Flow context changed within the same tab
    if (message.type === 'CONTEXT_UPDATED' && message.tabId === currentTabId) {
      currentContext = message.context;
      if (currentContext) {
        // Check if on Power Apps - show redirect message
        if (currentContext.isPowerApps) {
          backToEditorEl.classList.add('hidden');
          showState(powerAppsRedirectEl);
          return;
        }
        // Always keep the editor URL updated
        flowEditorUrl = getFlowEditorUrl(currentContext);
        updateBackButton();
        loadRuns();
      } else {
        backToEditorEl.classList.add('hidden');
        showState(noFlowEl);
      }
    }

    // Active browser tab changed - reload state for the new tab
    if (message.type === 'ACTIVE_TAB_CHANGED') {
      // Reset state so the panel reflects the newly active tab
      currentTabId = message.tabId;
      currentContext = null;
      flowEditorUrl = null;
      actionsCache.clear();
      runsById = new Map();
      showState(loadingEl);

      // Re-run initialization to load context and runs for the new tab
      init();
    }
  });

  // Event listeners
  refreshBtn.addEventListener('click', () => {
    if (currentContext && currentTabId) {
      loadRuns();
    }
  });

  retryBtn.addEventListener('click', () => {
    if (currentContext && currentTabId) {
      loadRuns();
    }
  });

  backBtn.addEventListener('click', returnToEditor);
  openInPowerAutomateBtn.addEventListener('click', openInPowerAutomate);

  // Start
  if (themeToggleBtn) {
    themeToggleBtn.addEventListener('click', () => {
      applyTheme(currentTheme === 'dark' ? 'light' : 'dark');
    });
  }

  loadThemePreference();
  init();
})();
