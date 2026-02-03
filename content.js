// Content script to detect Power Automate flow context and handle API calls

(function() {
  'use strict';

  // Extract flow context from URL
  function extractFlowContext() {
    const url = window.location.href;

    // Extract environment ID (always present)
    const envMatch = url.match(/\/environments\/([^/]+)/);
    if (!envMatch) return null;

    const environmentId = envMatch[1];
    let flowId = null;

    // Match /flows/{flowId} pattern
    const flowMatch = url.match(/\/flows\/([^/?]+)/);
    if (flowMatch) {
      flowId = flowMatch[1];
    }

    if (flowId) {
      return {
        environmentId: environmentId,
        flowId: flowId,
        origin: window.location.origin,
        url: url
      };
    }
    return null;
  }

  // Send flow context to background script
  function sendFlowContext() {
    try {
      const context = extractFlowContext();
      chrome.runtime.sendMessage({
        type: 'FLOW_CONTEXT',
        context: context
      }).catch(() => {});
    } catch (e) {
      // Extension context may be invalidated
    }
  }

  // Fetch runs using page's fetch (has auth cookies)
  async function fetchRunsFromPage(environmentId, flowId) {
    const apiUrl = `https://api.flow.microsoft.com/providers/Microsoft.ProcessSimple/environments/${environmentId}/flows/${flowId}/runs?api-version=2016-11-01&$top=10`;

    const response = await fetch(apiUrl, {
      method: 'GET',
      credentials: 'include',
      headers: {
        'Accept': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }

    const data = await response.json();
    return data.value || [];
  }

  // Listen for messages from sidepanel/background
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'GET_FLOW_CONTEXT') {
      sendResponse(extractFlowContext());
      return false;
    }

    if (message.type === 'FETCH_RUNS_REQUEST') {
      fetchRunsFromPage(message.environmentId, message.flowId)
        .then(runs => {
          sendResponse({ success: true, runs: runs });
        })
        .catch(error => {
          sendResponse({ success: false, error: error.message });
        });
      return true; // Keep channel open for async response
    }

    return false;
  });

  // Initial context send
  sendFlowContext();

  // Listen for URL changes (Power Automate is an SPA)
  let lastUrl = window.location.href;

  const observer = new MutationObserver(() => {
    if (window.location.href !== lastUrl) {
      lastUrl = window.location.href;
      sendFlowContext();
    }
  });

  if (document.body) {
    observer.observe(document.body, { childList: true, subtree: true });
  }

  window.addEventListener('popstate', sendFlowContext);
})();
