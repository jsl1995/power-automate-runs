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

  // Fetch runs by executing in page context
  if (message.type === 'FETCH_RUNS') {
    const { environmentId, flowId, tabId } = message;

    fetchRunsInPageContext(tabId, environmentId, flowId)
      .then(result => sendResponse(result))
      .catch(error => sendResponse({ success: false, error: error.message }));

    return true; // Keep channel open for async
  }

  return false;
});

// Execute fetch in the page's main world (has auth cookies)
async function fetchRunsInPageContext(tabId, environmentId, flowId) {
  const apiUrl = `https://api.flow.microsoft.com/providers/Microsoft.ProcessSimple/environments/${environmentId}/flows/${flowId}/runs?api-version=2016-11-01&$top=10`;

  const results = await chrome.scripting.executeScript({
    target: { tabId: tabId },
    world: 'MAIN',
    func: async (url) => {
      try {
        const response = await fetch(url, {
          method: 'GET',
          credentials: 'include',
          headers: { 'Accept': 'application/json' }
        });

        if (!response.ok) {
          return { success: false, error: `API error: ${response.status}` };
        }

        const data = await response.json();
        return { success: true, runs: data.value || [] };
      } catch (error) {
        return { success: false, error: error.message };
      }
    },
    args: [apiUrl]
  });

  // executeScript returns an array of results, one per frame
  if (results && results[0] && results[0].result) {
    return results[0].result;
  }

  return { success: false, error: 'Failed to execute script' };
}

// Clean up when tab is closed
chrome.tabs.onRemoved.addListener((tabId) => {
  tabContexts.delete(tabId);
});

// Enable side panel when clicking the action button
chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ tabId: tab.id });
});
