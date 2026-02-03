// Content script to detect Power Automate flow context and communicate with background

(function() {
  'use strict';

  // Extract flow context from URL
  function extractFlowContext() {
    const url = window.location.href;

    // Pattern: https://make.powerautomate.com/environments/{envId}/flows/{flowId}/...
    const match = url.match(/\/environments\/([^/]+)\/flows\/([^/?]+)/);

    if (match) {
      return {
        environmentId: match[1],
        flowId: match[2],
        url: url
      };
    }

    return null;
  }

  // Send flow context to background script
  function sendFlowContext() {
    const context = extractFlowContext();
    chrome.runtime.sendMessage({
      type: 'FLOW_CONTEXT',
      context: context
    });
  }

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

  observer.observe(document.body, {
    childList: true,
    subtree: true
  });

  // Also use popstate for back/forward navigation
  window.addEventListener('popstate', sendFlowContext);

  // Listen for messages from background/sidepanel
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'GET_FLOW_CONTEXT') {
      sendResponse(extractFlowContext());
    }
    return true;
  });
})();
