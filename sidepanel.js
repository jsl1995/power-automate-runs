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

  // Current state
  let currentContext = null;
  let currentTabId = null;
  let isLoading = false;
  let flowEditorUrl = null; // Store the flow editor URL to return to

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
        <div class="run-item" data-run-id="${runId}">
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
          <svg class="chevron" width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <path d="M6 4l4 4-4 4"/>
          </svg>
        </div>
      `;
    }).join('');

    // Add click handlers
    runsListEl.querySelectorAll('.run-item').forEach(item => {
      item.addEventListener('click', () => {
        const runId = item.dataset.runId;
        openRun(runId);
      });
    });

    showState(runsListEl);
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

  // Start
  init();
})();
