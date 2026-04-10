// Content script to detect Power Automate flow context and handle API calls

(function() {
  'use strict';

  // Flow id appears under different path shapes; order matters (e.g. /flows/shared/ must beat /flows/).
  function extractFlowIdFromUrl(url) {
    const patterns = [
      /\/flows\/shared\/([^/?]+)/,
      /\/flows\/([^/?]+)/,
      /\/objects\/cloudflows\/([^/?]+)/,
    ];
    for (let i = 0; i < patterns.length; i++) {
      const m = url.match(patterns[i]);
      if (m) return m[1];
    }
    return null;
  }

  // Extract flow context from URL
  function extractFlowContext() {
    const url = window.location.href;
    const origin = window.location.origin;
    const isPowerApps = origin.includes('powerapps.com');

    // Extract environment ID (always present)
    const envMatch = url.match(/\/environments\/([^/]+)/);
    if (!envMatch) return null;

    const environmentId = envMatch[1];
    const flowId = extractFlowIdFromUrl(url);

    if (flowId) {
      return {
        environmentId: environmentId,
        flowId: flowId,
        origin: origin,
        url: url,
        isPowerApps: isPowerApps
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

  // Listen for messages from sidepanel/background
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'GET_FLOW_CONTEXT') {
      sendResponse(extractFlowContext());
      return false;
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
