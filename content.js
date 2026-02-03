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
        origin: window.location.origin,
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

  // Inject a script into the page to make authenticated API calls
  function injectFetchScript() {
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('injected.js');
    script.onload = () => script.remove();
    (document.head || document.documentElement).appendChild(script);
  }

  // Listen for fetch results from injected script
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;

    if (event.data.type === 'PA_RUNS_RESULT') {
      chrome.runtime.sendMessage({
        type: 'RUNS_FETCHED',
        success: event.data.success,
        runs: event.data.runs,
        error: event.data.error
      });
    }
  });

  // Listen for fetch requests from background/sidepanel
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'GET_FLOW_CONTEXT') {
      sendResponse(extractFlowContext());
    }

    if (message.type === 'FETCH_RUNS_FROM_PAGE') {
      // Post message to injected script to make the fetch
      window.postMessage({
        type: 'PA_FETCH_RUNS',
        environmentId: message.environmentId,
        flowId: message.flowId
      }, '*');
    }

    return true;
  });

  // Initial setup
  injectFetchScript();
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
})();
