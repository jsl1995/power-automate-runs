// Background service worker for Power Automate Run History extension

// Store current flow context per tab
const tabContexts = new Map();

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
    }).catch(() => {});
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

  return false;
});

// Get auth token from page and fetch runs
async function fetchRunsWithToken(tabId, environmentId, flowId) {
  // Extract token from page's session storage
  const tokenResults = await chrome.scripting.executeScript({
    target: { tabId: tabId },
    world: 'MAIN',
    func: () => {
      // Power Automate stores tokens in sessionStorage
      // Look for the flow API token
      try {
        // Try to find token in sessionStorage
        for (let i = 0; i < sessionStorage.length; i++) {
          const key = sessionStorage.key(i);
          if (key && key.includes('flow.microsoft.com')) {
            const value = sessionStorage.getItem(key);
            try {
              const parsed = JSON.parse(value);
              if (parsed.accessToken || parsed.secret) {
                return parsed.accessToken || parsed.secret;
              }
            } catch (e) {
              // Not JSON, skip
            }
          }
        }

        // Try localStorage as fallback
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key && (key.includes('msal') || key.includes('flow'))) {
            const value = localStorage.getItem(key);
            try {
              const parsed = JSON.parse(value);
              if (parsed.accessToken || parsed.secret) {
                return parsed.accessToken || parsed.secret;
              }
            } catch (e) {
              // Not JSON, skip
            }
          }
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

// Clean up when tab is closed
chrome.tabs.onRemoved.addListener((tabId) => {
  tabContexts.delete(tabId);
});

// Enable side panel when clicking the action button
chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ tabId: tab.id });
});
