// Background service worker for Flow Run Buddy extension

// Store current flow context per tab
const tabContexts = new Map();

// Cache flow definitions to avoid repeated fetches
const flowDefinitionCache = new Map();

// Listen for messages
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Flow context update from content script
  if (message.type === 'FLOW_CONTEXT' && sender.tab) {
    const tabId = sender.tab.id;

    if (message.context) {
      tabContexts.set(tabId, message.context);
    } else {
      tabContexts.delete(tabId);
    }

    // Notify side panel of context change
    chrome.runtime.sendMessage({
      type: 'CONTEXT_UPDATED',
      context: message.context,
      tabId: tabId
    }).catch(() => { });
  }

  // Get context for a specific tab
  if (message.type === 'GET_CONTEXT_FOR_TAB') {
    sendResponse(tabContexts.get(message.tabId) || null);
    return true;
  }

  // Fetch runs - first get token from page, then fetch from background
  if (message.type === 'FETCH_RUNS') {
    const { environmentId, flowId, tabId } = message;

    fetchRunsWithToken(tabId, environmentId, flowId)
      .then(result => sendResponse(result))
      .catch(error => sendResponse({ success: false, error: error.message }));

    return true;
  }

  // Fetch run actions/steps
  if (message.type === 'FETCH_RUN_ACTIONS') {
    const { environmentId, flowId, runId, tabId } = message;

    fetchRunActions(tabId, environmentId, flowId, runId)
      .then(result => sendResponse(result))
      .catch(error => sendResponse({ success: false, error: error.message }));

    return true;
  }

  // Cancel a running flow
  if (message.type === 'CANCEL_RUN') {
    const { environmentId, flowId, runId, tabId } = message;

    cancelRun(tabId, environmentId, flowId, runId)
      .then(result => sendResponse(result))
      .catch(error => sendResponse({ success: false, error: error.message }));

    return true;
  }

  return false;
});

// Get auth token from page and fetch runs
async function fetchRunsWithToken(tabId, environmentId, flowId) {
  // Extract token from page's storage - look for Flow API token specifically
  const tokenResults = await chrome.scripting.executeScript({
    target: { tabId: tabId },
    world: 'MAIN',
    func: () => {
      try {
        // MSAL stores tokens with keys containing the scope/resource
        // Look for tokens scoped to flow.microsoft.com or service.flow.microsoft.com
        const flowScopes = ['flow.microsoft.com', 'service.flow.microsoft.com', 'api.flow.microsoft.com'];

        // Check sessionStorage first (MSAL often uses this)
        for (let i = 0; i < sessionStorage.length; i++) {
          const key = sessionStorage.key(i);
          if (!key) continue;

          const keyLower = key.toLowerCase();
          const isFlowToken = flowScopes.some(scope => keyLower.includes(scope));
          const isMsalToken = keyLower.includes('accesstoken') || keyLower.includes('access_token');

          if (isFlowToken || isMsalToken) {
            const value = sessionStorage.getItem(key);
            try {
              const parsed = JSON.parse(value);
              // MSAL format: { secret: "token..." } or { accessToken: "token..." }
              const token = parsed.secret || parsed.accessToken || parsed.access_token;
              if (token && typeof token === 'string' && token.length > 100) {
                // Verify it's a Flow API token by checking scope in key
                if (flowScopes.some(scope => keyLower.includes(scope))) {
                  return token;
                }
              }
            } catch (e) { }
          }
        }

        // Check localStorage
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (!key) continue;

          const keyLower = key.toLowerCase();
          const isFlowToken = flowScopes.some(scope => keyLower.includes(scope));
          const isMsalToken = keyLower.includes('accesstoken') || keyLower.includes('access_token');

          if (isFlowToken || isMsalToken) {
            const value = localStorage.getItem(key);
            try {
              const parsed = JSON.parse(value);
              const token = parsed.secret || parsed.accessToken || parsed.access_token;
              if (token && typeof token === 'string' && token.length > 100) {
                if (flowScopes.some(scope => keyLower.includes(scope))) {
                  return token;
                }
              }
            } catch (e) { }
          }
        }

        // Fallback: look for any valid-looking access token
        const allStorage = {
          ...Object.fromEntries(
            [...Array(sessionStorage.length)].map((_, i) => [sessionStorage.key(i), sessionStorage.getItem(sessionStorage.key(i))])
          ), ...Object.fromEntries(
            [...Array(localStorage.length)].map((_, i) => [localStorage.key(i), localStorage.getItem(localStorage.key(i))])
          )
        };

        for (const [key, value] of Object.entries(allStorage)) {
          if (!value) continue;
          try {
            const parsed = JSON.parse(value);
            const token = parsed.secret || parsed.accessToken;
            if (token && typeof token === 'string' && token.length > 500) {
              // Long tokens are likely JWT access tokens
              return token;
            }
          } catch (e) { }
        }

        return null;
      } catch (e) {
        return null;
      }
    }
  });

  const token = tokenResults?.[0]?.result;

  if (!token) {
    return { success: false, error: 'Could not find auth token. Please refresh the page.' };
  }

  // Now fetch from background (bypasses CORS)
  const apiUrl = `https://api.flow.microsoft.com/providers/Microsoft.ProcessSimple/environments/${environmentId}/flows/${flowId}/runs?api-version=2016-11-01&$top=10`;

  try {
    const response = await fetch(apiUrl, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'Authorization': `Bearer ${token}`
      }
    });

    if (!response.ok) {
      if (response.status === 401) {
        return { success: false, error: 'Token expired. Please refresh the page.' };
      }
      return { success: false, error: `API error: ${response.status}` };
    }

    const data = await response.json();
    return { success: true, runs: data.value || [] };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// Fetch flow definition to get action types and connector info
async function fetchFlowDefinition(tabId, environmentId, flowId, token) {
  const cacheKey = `${environmentId}:${flowId}`;

  // Return cached definition if available
  if (flowDefinitionCache.has(cacheKey)) {
    return flowDefinitionCache.get(cacheKey);
  }

  const apiUrl = `https://api.flow.microsoft.com/providers/Microsoft.ProcessSimple/environments/${environmentId}/flows/${flowId}?api-version=2016-11-01&$expand=definition,connectionReferences`;

  try {
    const response = await fetch(apiUrl, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'Authorization': `Bearer ${token}`
      }
    });

    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    const definition = data.properties?.definition || {};
    const connectionRefs = data.properties?.connectionReferences || {};

    // Build a map of action name -> action metadata
    const actionMetadata = {};
    const allActions = {
      ...(definition.actions || {}),
      ...(definition.triggers || {})
    };

    // Recursively extract actions from scopes (conditions, loops, etc.)
    function extractActions(actions, metadata) {
      for (const [name, action] of Object.entries(actions || {})) {
        metadata[name] = {
          type: action.type,
          kind: action.kind,
          connectorId: action.inputs?.host?.apiId || action.inputs?.host?.connectionName
        };

        // Handle nested actions in scopes, conditions, loops
        if (action.actions) {
          extractActions(action.actions, metadata);
        }
        if (action.else?.actions) {
          extractActions(action.else.actions, metadata);
        }
        if (action.cases) {
          for (const caseBlock of Object.values(action.cases)) {
            extractActions(caseBlock.actions, metadata);
          }
        }
        if (action.default?.actions) {
          extractActions(action.default.actions, metadata);
        }
      }
    }

    extractActions(allActions, actionMetadata);

    const result = { actionMetadata, connectionRefs };
    flowDefinitionCache.set(cacheKey, result);

    return result;
  } catch (error) {
    return null;
  }
}

// Fetch run actions/steps
async function fetchRunActions(tabId, environmentId, flowId, runId) {
  const token = await getToken(tabId);

  if (!token) {
    return { success: false, error: 'Could not find auth token.' };
  }

  // Fetch flow definition for action types (in parallel with run data)
  const [runResponse, flowDef] = await Promise.all([
    fetch(`https://api.flow.microsoft.com/providers/Microsoft.ProcessSimple/environments/${environmentId}/flows/${flowId}/runs/${runId}?api-version=2016-11-01&$expand=properties/actions`, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'Authorization': `Bearer ${token}`
      }
    }),
    fetchFlowDefinition(tabId, environmentId, flowId, token)
  ]);

  try {
    if (!runResponse.ok) {
      return { success: false, error: `API error: ${runResponse.status}` };
    }

    const data = await runResponse.json();
    const actions = data.properties?.actions || {};
    const actionMetadata = flowDef?.actionMetadata || {};

    // Convert actions object to sorted array with type info
    const actionsList = Object.entries(actions).map(([name, action]) => ({
      name: name,
      status: action.status,
      startTime: action.startTime,
      endTime: action.endTime,
      code: action.code,
      error: action.error,
      type: actionMetadata[name]?.type || null,
      kind: actionMetadata[name]?.kind || null
    })).sort((a, b) => {
      // Sort by start time
      if (!a.startTime) return 1;
      if (!b.startTime) return -1;
      return new Date(a.startTime) - new Date(b.startTime);
    });

    return { success: true, actions: actionsList };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// Cancel a running flow
async function cancelRun(tabId, environmentId, flowId, runId) {
  const token = await getToken(tabId);

  if (!token) {
    return { success: false, error: 'Could not find auth token.' };
  }

  const apiUrl = `https://api.flow.microsoft.com/providers/Microsoft.ProcessSimple/environments/${environmentId}/flows/${flowId}/runs/${runId}/cancel?api-version=2016-11-01`;

  try {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Authorization': `Bearer ${token}`
      }
    });

    if (!response.ok) {
      if (response.status === 400) {
        return { success: false, error: 'Run cannot be cancelled (may have already completed).' };
      }
      return { success: false, error: `API error: ${response.status}` };
    }

    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// Extract token helper (reused by multiple fetch functions)
async function getToken(tabId) {
  const tokenResults = await chrome.scripting.executeScript({
    target: { tabId: tabId },
    world: 'MAIN',
    func: () => {
      try {
        const flowScopes = ['flow.microsoft.com', 'service.flow.microsoft.com', 'api.flow.microsoft.com'];

        for (let i = 0; i < sessionStorage.length; i++) {
          const key = sessionStorage.key(i);
          if (!key) continue;
          const keyLower = key.toLowerCase();
          if (flowScopes.some(scope => keyLower.includes(scope))) {
            const value = sessionStorage.getItem(key);
            try {
              const parsed = JSON.parse(value);
              const token = parsed.secret || parsed.accessToken;
              if (token && token.length > 100) return token;
            } catch (e) { }
          }
        }

        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (!key) continue;
          const keyLower = key.toLowerCase();
          if (flowScopes.some(scope => keyLower.includes(scope))) {
            const value = localStorage.getItem(key);
            try {
              const parsed = JSON.parse(value);
              const token = parsed.secret || parsed.accessToken;
              if (token && token.length > 100) return token;
            } catch (e) { }
          }
        }

        return null;
      } catch (e) {
        return null;
      }
    }
  });

  return tokenResults?.[0]?.result;
}

// Clean up when tab is closed
chrome.tabs.onRemoved.addListener((tabId) => {
  tabContexts.delete(tabId);
});

// Notify extension when the active tab changes so UI can refresh
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  try {
    const tab = await chrome.tabs.get(activeInfo.tabId);

    // Let extension pages (e.g. side panel) know the active tab changed
    chrome.runtime.sendMessage({
      type: 'ACTIVE_TAB_CHANGED',
      tabId: activeInfo.tabId,
      url: tab.url
    }).catch(() => { });
  } catch (e) {
    // Ignore errors from tabs that may have been closed or are inaccessible
  }
});

// Enable side panel when clicking the action button
chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ tabId: tab.id });
});
