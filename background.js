// Background service worker for Power Automate Run History extension

// Store current flow context per tab
const tabContexts = new Map();

// Listen for flow context updates from content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
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
    }).catch(() => {
      // Side panel might not be open, ignore error
    });
  }

  if (message.type === 'GET_CONTEXT_FOR_TAB') {
    sendResponse(tabContexts.get(message.tabId) || null);
    return true;
  }

  if (message.type === 'FETCH_RUNS') {
    fetchRuns(message.environmentId, message.flowId)
      .then(runs => sendResponse({ success: true, runs }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true; // Keep channel open for async response
  }

  return true;
});

// Clean up when tab is closed
chrome.tabs.onRemoved.addListener((tabId) => {
  tabContexts.delete(tabId);
});

// Enable side panel when clicking the action button
chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ tabId: tab.id });
});

// Fetch runs from Power Automate API
async function fetchRuns(environmentId, flowId) {
  const apiUrl = `https://api.flow.microsoft.com/providers/Microsoft.ProcessSimple/environments/${environmentId}/flows/${flowId}/runs?api-version=2016-11-01&$top=10`;

  const response = await fetch(apiUrl, {
    method: 'GET',
    credentials: 'include',
    headers: {
      'Accept': 'application/json'
    }
  });

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new Error('Not authenticated. Please sign in to Power Automate.');
    }
    throw new Error(`API error: ${response.status}`);
  }

  const data = await response.json();
  return data.value || [];
}
