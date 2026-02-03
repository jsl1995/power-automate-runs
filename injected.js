// Injected script that runs in the page context to make authenticated API calls

(function() {
  'use strict';

  window.addEventListener('message', async (event) => {
    if (event.source !== window) return;

    if (event.data.type === 'PA_FETCH_RUNS') {
      const { environmentId, flowId } = event.data;

      try {
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

        window.postMessage({
          type: 'PA_RUNS_RESULT',
          success: true,
          runs: data.value || []
        }, '*');

      } catch (error) {
        window.postMessage({
          type: 'PA_RUNS_RESULT',
          success: false,
          error: error.message
        }, '*');
      }
    }
  });
})();
