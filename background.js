// Background service worker for Power Automate Run History extension

// Store current flow context per tab
const tabContexts = new Map();

// Store pending fetch callbacks
const pendingFetches = new Map();

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
    }).catch(() => {
      // Side panel might not be open, ignore error
    });
  }

  // Get context for a specific tab
  if (message.type === 'GET_CONTEXT_FOR_TAB') {
    sendResponse(tabContexts.get(message.tabId) || null);
    return true;
  }

  // Fetch runs request from sidepanel
  if (message.type === 'FETCH_RUNS') {
    const { environmentId, flowId, tabId } = message;

    // Send request to content script to fetch via injected script
    chrome.tabs.sendMessage(tabId, {
      type: 'FETCH_RUNS_FROM_PAGE',
      environmentId: environmentId,
      flowId: flowId
    }).catch(error => {
      sendResponse({ success: false, error: error.message });
    });

    // Store the callback to respond when we get results
    pendingFetches.set(tabId, sendResponse);
    return true; // Keep channel open for async response
  }

  // Runs fetched from content script (via injected script)
  if (message.type === 'RUNS_FETCHED' && sender.tab) {
    const tabId = sender.tab.id;
    const callback = pendingFetches.get(tabId);

    if (callback) {
      callback({
        success: message.success,
        runs: message.runs,
        error: message.error
      });
      pendingFetches.delete(tabId);
    }
  }

  return true;
});

// Clean up when tab is closed
chrome.tabs.onRemoved.addListener((tabId) => {
  tabContexts.delete(tabId);
  pendingFetches.delete(tabId);
});

// Enable side panel when clicking the action button
chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ tabId: tab.id });
});
