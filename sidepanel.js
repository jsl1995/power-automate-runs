// Side panel logic for Power Automate Run History

(function() {
  'use strict';

  // DOM elements
  const loadingEl = document.getElementById('loading');
  const noFlowEl = document.getElementById('no-flow');
  const errorEl = document.getElementById('error');
  const errorMessageEl = document.getElementById('error-message');
  const runsListEl = document.getElementById('runs-list');
  const noRunsEl = document.getElementById('no-runs');
  const refreshBtn = document.getElementById('refresh-btn');
  const retryBtn = document.getElementById('retry-btn');
  const backToEditorEl = document.getElementById('back-to-editor');
  const backBtn = document.getElementById('back-btn');
  const openPowerAppsBtn = document.getElementById('open-powerapps');
  const openPowerAutomateBtn = document.getElementById('open-powerautomate');

  // Current state
  let currentContext = null;
  let currentTabId = null;
  let isLoading = false;
  let flowEditorUrl = null; // Store the flow editor URL to return to
  let savedSolutionId = null; // Preserve solution ID across navigation

  // Show a specific state
  function showState(state) {
    loadingEl.classList.add('hidden');
    noFlowEl.classList.add('hidden');
    errorEl.classList.add('hidden');
    runsListEl.classList.add('hidden');
    noRunsEl.classList.add('hidden');

    state.classList.remove('hidden');
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

  // Cache for loaded actions
  const actionsCache = new Map();

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

    showState(runsListEl);
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

      // Load actions if not cached
      if (!actionsCache.has(runId)) {
        await loadActions(container, runId);
      } else {
        renderActions(actionsContainer, actionsCache.get(runId));
      }
    }
  }

  // Load actions for a run
  async function loadActions(container, runId) {
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
        renderActions(actionsContainer, response.actions);
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
  function renderActions(container, actions) {
    if (!actions || actions.length === 0) {
      container.innerHTML = '<div class="actions-empty">No steps found</div>';
      return;
    }

    container.innerHTML = actions.map(action => {
      const status = getStatusInfo(action.status);
      return `
        <div class="action-item">
          <div class="action-status ${status.class}">${status.icon}</div>
          <div class="action-name">${action.name}</div>
        </div>
      `;
    }).join('');
  }

  // Check if current URL is a run page (not the editor)
  function isRunPage(url) {
    return url && url.includes('/runs/');
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

    const { environmentId, flowId, solutionId, origin } = currentContext;
    const effectiveSolutionId = solutionId || savedSolutionId;
    const baseUrl = origin || 'https://make.powerautomate.com';

    let runUrl;
    if (effectiveSolutionId && baseUrl.includes('powerapps.com')) {
      // Use cloudflows URL pattern for Power Apps
      runUrl = `${baseUrl}/environments/${environmentId}/solutions/${effectiveSolutionId}/objects/cloudflows/${flowId}/runs/${runId}`;
    } else {
      // Standard flows URL for Power Automate
      runUrl = `${baseUrl}/environments/${environmentId}/flows/${flowId}/runs/${runId}`;
    }

    chrome.tabs.update(currentTabId, { url: runUrl });
  }

  // Return to flow editor (original site)
  function returnToEditor() {
    if (flowEditorUrl && currentTabId) {
      chrome.tabs.update(currentTabId, { url: flowEditorUrl });
    }
  }

  // Open flow in Power Apps
  function openInPowerApps() {
    if (!currentContext || !currentTabId) return;
    const { environmentId, flowId, solutionId } = currentContext;

    // Use saved solution ID if current context doesn't have one
    const effectiveSolutionId = solutionId || savedSolutionId;

    let url;
    if (effectiveSolutionId) {
      // Use cloudflows URL pattern when we have a solution ID
      url = `https://make.powerapps.com/environments/${environmentId}/solutions/${effectiveSolutionId}/objects/cloudflows/${flowId}/view`;
    } else {
      // Fallback to standard flows URL
      url = `https://make.powerapps.com/environments/${environmentId}/flows/${flowId}`;
    }
    chrome.tabs.update(currentTabId, { url: url });
  }

  // Open flow in Power Automate
  function openInPowerAutomate() {
    if (!currentContext || !currentTabId) return;
    const { environmentId, flowId } = currentContext;
    const url = `https://make.powerautomate.com/environments/${environmentId}/flows/${flowId}`;
    chrome.tabs.update(currentTabId, { url: url });
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
        // Save solution ID if present (preserve across navigation)
        if (context.solutionId) {
          savedSolutionId = context.solutionId;
        }
        // Always store/update the editor URL from context
        flowEditorUrl = getFlowEditorUrl(context);
        updateBackButton();
        loadRuns();
      } else {
        showState(noFlowEl);
      }
    } catch (error) {
      showState(noFlowEl);
    }
  }

  // Listen for context updates
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'CONTEXT_UPDATED' && message.tabId === currentTabId) {
      currentContext = message.context;
      if (currentContext) {
        // Save solution ID if present (preserve across navigation)
        if (currentContext.solutionId) {
          savedSolutionId = currentContext.solutionId;
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
  openPowerAppsBtn.addEventListener('click', openInPowerApps);
  openPowerAutomateBtn.addEventListener('click', openInPowerAutomate);

  // Start
  init();
})();
