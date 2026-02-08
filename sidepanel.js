// Side panel logic for Flow Run Buddy

(function () {
  'use strict';

  // Helper function to escape HTML to prevent XSS
  function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // Helper function to show accessible notifications instead of alert()
  function showNotification(message, type = 'error') {
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.setAttribute('role', 'alert');
    notification.setAttribute('aria-live', 'assertive');
    notification.textContent = message;

    document.body.appendChild(notification);

    // Auto-dismiss after 5 seconds
    setTimeout(() => {
      notification.classList.add('notification-fadeout');
      setTimeout(() => notification.remove(), 300);
    }, 5000);

    // Allow manual dismissal
    notification.addEventListener('click', () => {
      notification.classList.add('notification-fadeout');
      setTimeout(() => notification.remove(), 300);
    });
  }

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
        themeToggleBtn.setAttribute('aria-label', 'Switch to light mode');
      }
    } else {
      document.body.classList.remove('dark-theme');
      if (themeToggleBtn) {
        themeToggleBtn.setAttribute('aria-label', 'Switch to dark mode');
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
      const relativeTime = escapeHtml(formatRelativeTime(startTime));
      const statusLabel = escapeHtml(status.label);

      return `
        <div class="run-container" data-run-id="${escapeHtml(runId)}" role="listitem">
          <div class="run-item">
            <button class="expand-btn" aria-label="Expand to see flow steps" aria-expanded="false">
              <svg class="expand-icon" width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                <path d="M4 6l4 4 4-4"/>
              </svg>
            </button>
            <div class="status-icon ${status.class}" aria-label="${statusLabel}">
              ${status.icon}
            </div>
            <div class="run-details">
              <div class="run-time">${relativeTime}</div>
              <div class="run-meta">
                <span class="run-status">${statusLabel}</span>
                ${duration ? `<span class="run-duration">· ${escapeHtml(duration)}</span>` : ''}
              </div>
            </div>
            ${isRunning ? `
              <button class="cancel-btn" aria-label="Cancel run">
                <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                  <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="2" fill="none"/>
                </svg>
              </button>
            ` : ''}
            <button class="rerun-btn" aria-label="Resubmit this flow run">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                <path d="M2 8a6 6 0 1 1 6 6" stroke="currentColor" stroke-width="2" fill="none"/>
                <path d="M2 4v4h4" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </button>
            <button class="open-btn" aria-label="Open flow run details">
              <svg class="chevron" width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                <path d="M6 4l4 4-4 4"/>
              </svg>
            </button>
          </div>
          <div class="actions-container hidden" aria-live="polite">
            <div class="actions-loading">
              <div class="spinner-small" role="status" aria-label="Loading"></div>
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

    // Add click handlers for rerun buttons
    runsListEl.querySelectorAll('.rerun-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const container = btn.closest('.run-container');
        const runId = container.dataset.runId;
        rerunFlow(runId, btn);
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
          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
            <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="2" fill="none"/>
          </svg>
        `;
        showNotification(response?.error || 'Failed to cancel run', 'error');
      }
    } catch (error) {
      btn.disabled = false;
      btn.classList.remove('cancelling');
      btn.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
          <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="2" fill="none"/>
        </svg>
      `;
      showNotification(error.message || 'Failed to cancel run', 'error');
    }
  }

  // Rerun a flow
  async function rerunFlow(runId, btn) {
    if (!currentContext || !currentTabId) return;

    // Disable button and show loading state
    btn.disabled = true;
    btn.classList.add('rerunning');
    btn.innerHTML = '<div class="spinner-tiny"></div>';

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'RESUBMIT_RUN',
        environmentId: currentContext.environmentId,
        flowId: currentContext.flowId,
        runId: runId,
        tabId: currentTabId
      });

      if (response && response.success) {
        // Refresh the runs list to show new run
        await loadRuns();
      } else {
        // Re-enable button on error
        btn.disabled = false;
        btn.classList.remove('rerunning');
        btn.innerHTML = `
          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
            <path d="M2 8a6 6 0 1 1 6 6" stroke="currentColor" stroke-width="2" fill="none"/>
            <path d="M2 4v4h4" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        `;
        showNotification(response?.error || 'Failed to resubmit run', 'error');
      }
    } catch (error) {
      btn.disabled = false;
      btn.classList.remove('rerunning');
      btn.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
          <path d="M2 8a6 6 0 1 1 6 6" stroke="currentColor" stroke-width="2" fill="none"/>
          <path d="M2 4v4h4" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      `;
      showNotification(error.message || 'Failed to resubmit run', 'error');
    }
  }

  // Toggle expand/collapse for a run
  async function toggleExpand(container, runId) {
    const actionsContainer = container.querySelector('.actions-container');
    const expandIcon = container.querySelector('.expand-icon');
    const expandBtn = container.querySelector('.expand-btn');
    const isExpanded = container.classList.contains('expanded');

    if (isExpanded) {
      // Collapse
      container.classList.remove('expanded');
      actionsContainer.classList.add('hidden');
      expandIcon.style.transform = '';
      if (expandBtn) {
        expandBtn.setAttribute('aria-expanded', 'false');
      }
    } else {
      // Expand
      container.classList.add('expanded');
      actionsContainer.classList.remove('hidden');
      expandIcon.style.transform = 'rotate(-180deg)';
      if (expandBtn) {
        expandBtn.setAttribute('aria-expanded', 'true');
      }

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
      <div class="actions-run-error" role="alert">
        ${escapeHtml(runError)}
      </div>
    ` : '';

    const actionsHtml = actions.map(action => {
      const status = getStatusInfo(action.status);
      const errorMessage = action.error?.message || action.error?.details?.[0]?.message;
      const actionName = escapeHtml(action.name);
      const statusLabel = escapeHtml(status.label);
      return `
        <div class="action-item">
          <div class="action-status ${status.class}" aria-label="${statusLabel}">${status.icon}</div>
          <div class="action-main">
            <div class="action-name">${actionName}</div>
            ${status.class === 'failed' && errorMessage ? `
              <div class="action-error" role="alert">
                ${escapeHtml(errorMessage)}
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
        onRunsLoaded(); // Notify walkthrough that runs are available
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
        initWalkthrough(); // Start walkthrough for first-time users
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
          initWalkthrough(); // Start walkthrough for first-time users
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

  // ==================== WALKTHROUGH SYSTEM ====================
  const walkthroughContainer = document.getElementById('walkthrough-container');
  let walkthroughActive = false;
  let walkthroughStep = 0;
  let walkthroughRunsLoaded = false;

  const walkthroughSteps = [
    {
      id: 'expand',
      title: 'Expand Flow Steps',
      description: 'Click the expand button to see all the steps that ran in this flow execution.',
      selector: '.expand-btn',
      arrowPosition: 'left'
    },
    {
      id: 'open',
      title: 'Open Run Details',
      description: 'Click to open the full run details in Power Automate where you can inspect each step.',
      selector: '.open-btn',
      arrowPosition: 'left'
    },
    {
      id: 'cancel',
      title: 'Cancel Running Flows',
      description: 'When a flow is running, you can cancel it here. This button only appears for active runs.',
      selector: '.cancel-btn',
      arrowPosition: 'left',
      optional: true,
      fallbackDescription: 'When a flow is running, a cancel button appears here to stop it mid-execution.'
    },
    {
      id: 'resubmit',
      title: 'Resubmit a Flow',
      description: 'Click to resubmit the flow with the same trigger data. Great for retrying failed runs!',
      selector: '.rerun-btn',
      arrowPosition: 'left'
    },
    {
      id: 'back',
      title: 'Return to Flow Editor',
      description: 'At any time, click this button to get back to the flow you\'ve been working on.',
      selector: '#back-btn',
      arrowPosition: 'bottom'
    },
    {
      id: 'theme',
      title: 'Dark Mode',
      description: 'Toggle between light and dark themes to match your preference or reduce eye strain.',
      selector: '#theme-toggle',
      arrowPosition: 'bottom'
    }
  ];

  // Check if walkthrough should be shown
  async function checkWalkthroughStatus() {
    return new Promise((resolve) => {
      try {
        chrome.storage?.local?.get(['walkthroughCompleted', 'walkthroughDismissed'], (result) => {
          if (chrome.runtime.lastError) {
            resolve({ shouldShow: false });
            return;
          }
          const completed = result?.walkthroughCompleted === true;
          const dismissed = result?.walkthroughDismissed === true;
          resolve({ shouldShow: !completed && !dismissed });
        });
      } catch (e) {
        resolve({ shouldShow: false });
      }
    });
  }

  // Mark walkthrough as completed
  function completeWalkthrough() {
    try {
      chrome.storage?.local?.set({ walkthroughCompleted: true });
    } catch (e) {
      // Ignore storage errors
    }
    endWalkthrough();
  }

  // Mark walkthrough as dismissed
  function dismissWalkthrough() {
    try {
      chrome.storage?.local?.set({ walkthroughDismissed: true });
    } catch (e) {
      // Ignore storage errors
    }
    endWalkthrough();
  }

  // Show welcome modal
  function showWelcomeModal() {
    walkthroughContainer.innerHTML = `
      <div class="walkthrough-overlay"></div>
      <div class="walkthrough-welcome">
        <div class="walkthrough-welcome-icon">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>
          </svg>
        </div>
        <h2>Welcome to Flow Run Buddy!</h2>
        <p>Let's take a quick tour to show you how to view run history, expand steps, and manage your flows.</p>
        <div class="walkthrough-welcome-actions">
          <button class="walkthrough-start-btn" id="walkthrough-start">Start Tour</button>
          <button class="walkthrough-dismiss-btn" id="walkthrough-dismiss">Skip for now</button>
        </div>
      </div>
    `;

    document.getElementById('walkthrough-start').addEventListener('click', () => {
      walkthroughActive = true;
      walkthroughStep = 0;
      // Wait for runs to load before showing steps
      if (walkthroughRunsLoaded) {
        showWalkthroughStep();
      } else {
        showWaitingForRuns();
      }
    });

    document.getElementById('walkthrough-dismiss').addEventListener('click', dismissWalkthrough);
  }

  // Show waiting state while runs load
  function showWaitingForRuns() {
    walkthroughContainer.innerHTML = `
      <div class="walkthrough-overlay"></div>
      <div class="walkthrough-welcome">
        <div class="spinner" style="margin: 0 auto 16px;"></div>
        <h2>Loading runs...</h2>
        <p>Please wait while we load your flow runs to continue the tour.</p>
      </div>
    `;
  }

  // Show current walkthrough step
  function showWalkthroughStep() {
    if (!walkthroughActive || walkthroughStep >= walkthroughSteps.length) {
      completeWalkthrough();
      return;
    }

    const step = walkthroughSteps[walkthroughStep];
    const targetEl = document.querySelector(step.selector);

    // Handle optional steps (like cancel button which may not be present)
    if (!targetEl && step.optional) {
      // Show a general tooltip explaining this feature
      showOptionalStepTooltip(step);
      return;
    }

    if (!targetEl) {
      // Skip to next step if target not found
      walkthroughStep++;
      showWalkthroughStep();
      return;
    }

    // Clear previous highlights
    document.querySelectorAll('.walkthrough-highlight').forEach(el => {
      el.classList.remove('walkthrough-highlight');
    });

    // Highlight the target element
    targetEl.classList.add('walkthrough-highlight');

    // Get position for tooltip - use element position relative to sidepanel
    const rect = targetEl.getBoundingClientRect();
    const containerRect = walkthroughContainer.getBoundingClientRect();
    const tooltipTop = rect.bottom - containerRect.top + 12;
    // Calculate arrow position to point at the center of the target element
    const arrowLeft = Math.max(20, Math.min(rect.left - containerRect.left + rect.width / 2 - 6, containerRect.width - 32));

    // Build dots indicator
    const dotsHtml = walkthroughSteps.map((_, i) => {
      let dotClass = 'walkthrough-dot';
      if (i < walkthroughStep) dotClass += ' completed';
      else if (i === walkthroughStep) dotClass += ' active';
      return `<div class="${dotClass}"></div>`;
    }).join('');

    walkthroughContainer.innerHTML = `
      <div class="walkthrough-overlay"></div>
      <div class="walkthrough-tooltip arrow-top" style="top: ${tooltipTop}px; --arrow-left: ${arrowLeft}px;">
        <div class="walkthrough-step-indicator">
          <div class="walkthrough-step-badge">${walkthroughStep + 1}</div>
          <div class="walkthrough-step-count">of ${walkthroughSteps.length}</div>
        </div>
        <div class="walkthrough-title">${step.title}</div>
        <div class="walkthrough-description">${step.description}</div>
        <div class="walkthrough-actions">
          <button class="walkthrough-skip" id="walkthrough-skip">Skip tour</button>
          <div class="walkthrough-dots">${dotsHtml}</div>
          <button class="walkthrough-next" id="walkthrough-next">
            ${walkthroughStep === walkthroughSteps.length - 1 ? 'Finish' : 'Next'}
          </button>
        </div>
      </div>
    `;

    // Re-highlight (in case innerHTML cleared it)
    targetEl.classList.add('walkthrough-highlight');

    document.getElementById('walkthrough-skip').addEventListener('click', dismissWalkthrough);
    document.getElementById('walkthrough-next').addEventListener('click', () => {
      walkthroughStep++;
      showWalkthroughStep();
    });
  }

  // Show tooltip for optional steps (like cancel button when no running flows)
  function showOptionalStepTooltip(step) {
    // Use the first run item as reference point
    const runItem = document.querySelector('.run-item');
    if (!runItem) {
      walkthroughStep++;
      showWalkthroughStep();
      return;
    }

    const rect = runItem.getBoundingClientRect();
    const containerRect = walkthroughContainer.getBoundingClientRect();
    const tooltipTop = rect.bottom - containerRect.top + 12;

    const dotsHtml = walkthroughSteps.map((_, i) => {
      let dotClass = 'walkthrough-dot';
      if (i < walkthroughStep) dotClass += ' completed';
      else if (i === walkthroughStep) dotClass += ' active';
      return `<div class="${dotClass}"></div>`;
    }).join('');

    const description = step.fallbackDescription || step.description;

    walkthroughContainer.innerHTML = `
      <div class="walkthrough-overlay"></div>
      <div class="walkthrough-tooltip arrow-top" style="top: ${tooltipTop}px; --arrow-left: 24px;">
        <div class="walkthrough-step-indicator">
          <div class="walkthrough-step-badge">${walkthroughStep + 1}</div>
          <div class="walkthrough-step-count">of ${walkthroughSteps.length}</div>
        </div>
        <div class="walkthrough-title">${step.title}</div>
        <div class="walkthrough-description">${description}</div>
        <div class="walkthrough-actions">
          <button class="walkthrough-skip" id="walkthrough-skip">Skip tour</button>
          <div class="walkthrough-dots">${dotsHtml}</div>
          <button class="walkthrough-next" id="walkthrough-next">
            ${walkthroughStep === walkthroughSteps.length - 1 ? 'Finish' : 'Next'}
          </button>
        </div>
      </div>
    `;

    document.getElementById('walkthrough-skip').addEventListener('click', dismissWalkthrough);
    document.getElementById('walkthrough-next').addEventListener('click', () => {
      walkthroughStep++;
      showWalkthroughStep();
    });
  }

  // End walkthrough and cleanup
  function endWalkthrough() {
    walkthroughActive = false;
    walkthroughStep = 0;
    walkthroughContainer.innerHTML = '';
    document.querySelectorAll('.walkthrough-highlight').forEach(el => {
      el.classList.remove('walkthrough-highlight');
    });
  }

  // Called when runs are loaded - continue walkthrough if active
  function onRunsLoaded() {
    walkthroughRunsLoaded = true;
    if (walkthroughActive && walkthroughStep === 0) {
      showWalkthroughStep();
    }
  }

  // Initialize walkthrough on first load
  async function initWalkthrough() {
    const { shouldShow } = await checkWalkthroughStatus();
    if (shouldShow && currentContext && !currentContext.isPowerApps) {
      showWelcomeModal();
    }
  }

  // ==================== END WALKTHROUGH SYSTEM ====================

  // Start
  if (themeToggleBtn) {
    themeToggleBtn.addEventListener('click', () => {
      applyTheme(currentTheme === 'dark' ? 'light' : 'dark');
    });
  }

  loadThemePreference();
  init();
})();
