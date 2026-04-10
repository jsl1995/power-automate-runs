// Background service worker for Flow Run Buddy extension

// Store current flow context per tab
const tabContexts = new Map();

// Handle extension install/update
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install") {
    // First install - ensure walkthrough flags are cleared so it shows
    chrome.storage.local.remove([
      "walkthroughCompleted",
      "walkthroughDismissed",
    ]);
  }
});

// Listen for messages
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Flow context update from content script
  if (message.type === "FLOW_CONTEXT" && sender.tab) {
    const tabId = sender.tab.id;

    if (message.context) {
      tabContexts.set(tabId, message.context);
    } else {
      tabContexts.delete(tabId);
    }

    // Notify side panel of context change
    chrome.runtime
      .sendMessage({
        type: "CONTEXT_UPDATED",
        context: message.context,
        tabId: tabId,
      })
      .catch(() => {});
  }

  // Get context for a specific tab
  if (message.type === "GET_CONTEXT_FOR_TAB") {
    sendResponse(tabContexts.get(message.tabId) || null);
    return true;
  }

  // Fetch runs - first get token from page, then fetch from background
  if (message.type === "FETCH_RUNS") {
    const { environmentId, flowId, tabId } = message;

    fetchRunsWithToken(tabId, environmentId, flowId)
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ success: false, error: error.message }));

    return true;
  }

  // Fetch run actions/steps
  if (message.type === "FETCH_RUN_ACTIONS") {
    const { environmentId, flowId, runId, tabId } = message;

    fetchRunActions(tabId, environmentId, flowId, runId)
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ success: false, error: error.message }));

    return true;
  }

  // Cancel a running flow
  if (message.type === "CANCEL_RUN") {
    const { environmentId, flowId, runId, tabId } = message;

    cancelRun(tabId, environmentId, flowId, runId)
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ success: false, error: error.message }));

    return true;
  }

  // Resubmit a flow run
  if (message.type === "RESUBMIT_RUN") {
    const { environmentId, flowId, runId, tabId } = message;

    resubmitRun(tabId, environmentId, flowId, runId)
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ success: false, error: error.message }));

    return true;
  }

  // Fetch action input/output content from a pre-authenticated URI
  if (message.type === "FETCH_ACTION_CONTENT") {
    const { contentUri } = message;

    fetchActionContent(contentUri)
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ success: false, error: error.message }));

    return true;
  }

  // Fetch flow definition for export
  if (message.type === "FETCH_FLOW_DEFINITION") {
    const { environmentId, flowId, tabId } = message;

    fetchFlowDefinition(tabId, environmentId, flowId)
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ success: false, error: error.message }));

    return true;
  }

  // Save in Flow Editor tab then trigger the flow
  if (message.type === "SAVE_AND_RUN") {
    const { environmentId, flowId, tabId } = message;

    runSaveAndTriggerFlow(tabId, environmentId, flowId)
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ success: false, error: error.message }));

    return true;
  }

  return false;
});

/** Decode JWT payload (no signature verification). */
function decodeJwtPayload(token) {
  try {
    const parts = token.split(".");
    if (parts.length < 2) return null;
    let b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    while (b64.length % 4) b64 += "=";
    return JSON.parse(atob(b64));
  } catch {
    return null;
  }
}

/** Score JWT for calling api.flow.microsoft.com (aud + scp; no verification). */
function flowApiTokenSortKey(payload) {
  let audScore = 0;
  let scpScore = 0;
  if (payload?.aud) {
    const aud = Array.isArray(payload.aud)
      ? payload.aud.join(" ")
      : String(payload.aud);
    if (aud.includes("api.flow.microsoft.com")) audScore = 100;
    else if (aud.includes("api.powerplatform.com")) audScore = 93;
    else if (aud.includes("service.flow.microsoft.com")) audScore = 80;
    else if (aud.includes("flow.microsoft")) audScore = 50;
  }

  const scpRaw =
    typeof payload?.scp === "string"
      ? payload.scp
      : Array.isArray(payload?.scp)
        ? payload.scp.join(" ")
        : "";
  const scp = scpRaw.toLowerCase();
  if (
    scp.includes("aiflows.runs") ||
    scp.includes("aiflows.ai") ||
    scp.includes("aiflows.")
  ) {
    scpScore += 28;
  }
  if (scp.includes("powerautomate")) scpScore += 12;
  if (scp.includes("runs.read") || scp.includes("runs.write")) scpScore += 8;

  return audScore + scpScore;
}

/**
 * Prefer tokens whose `aud` / `scp` match Flow / Power Platform APIs, then unexpired,
 * then discovery order.
 */
function rankTokensForFlowApi(tokens) {
  const now = Math.floor(Date.now() / 1000);
  const scored = tokens.map((t, index) => {
    const payload = decodeJwtPayload(t);
    const expired = Boolean(payload?.exp && payload.exp <= now);
    const sortKey = flowApiTokenSortKey(payload);
    return { t, index, sortKey, expired };
  });

  scored.sort((a, b) => {
    if (a.expired !== b.expired) return a.expired ? 1 : -1;
    if (b.sortKey !== a.sortKey) return b.sortKey - a.sortKey;
    return a.index - b.index;
  });

  return scored.map((s) => s.t);
}

// Collect every MSAL Flow-related access token from the tab (MAIN world).
async function collectRawFlowMsalTokens(tabId) {
  const tokenResults = await chrome.scripting.executeScript({
    target: { tabId: tabId },
    world: "MAIN",
    func: () => {
      try {
        const MIN_LEN = 100;
        const flowMarkers = [
          "api.flow.microsoft.com",
          "service.flow.microsoft.com",
          "flow.microsoft.com",
        ];

        function extractTokenFromParsed(parsed) {
          if (parsed == null) return null;
          if (typeof parsed === "string") {
            return parsed.length >= MIN_LEN ? parsed : null;
          }
          if (typeof parsed !== "object") return null;

          const direct =
            parsed.secret ||
            parsed.accessToken ||
            parsed.access_token ||
            parsed.token;
          if (typeof direct === "string" && direct.length >= MIN_LEN) {
            return direct;
          }

          if (typeof parsed.data === "string") {
            const d = parsed.data;
            try {
              const inner = JSON.parse(d);
              const t = extractTokenFromParsed(inner);
              if (t) return t;
            } catch (e) {
              if (d.length >= MIN_LEN) return d;
            }
            return null;
          }

          if (parsed.data && typeof parsed.data === "object") {
            const inner =
              parsed.data.secret ||
              parsed.data.accessToken ||
              parsed.data.access_token ||
              parsed.data.token;
            if (typeof inner === "string" && inner.length >= MIN_LEN) {
              return inner;
            }
          }

          return null;
        }

        function isMsalAccessTokenKey(keyLower) {
          return (
            keyLower.includes("accesstoken") ||
            keyLower.includes("access_token")
          );
        }

        /** MSAL 2.x: Power Platform token used for cloud/AI flows (not in *.flow.microsoft key text). */
        function isPowerPlatformFlowTokenKey(keyLower) {
          if (!keyLower.includes("api.powerplatform.com")) return false;
          return (
            keyLower.includes("powerautomate") || keyLower.includes("aiflows")
          );
        }

        const seen = new Set();
        const tokens = [];

        function addToken(token) {
          if (token && token.length >= MIN_LEN && !seen.has(token)) {
            seen.add(token);
            tokens.push(token);
          }
        }

        function scanStore(store) {
          const keys = [];
          for (let i = 0; i < store.length; i++) {
            const key = store.key(i);
            if (key) keys.push(key);
          }

          for (const marker of flowMarkers) {
            for (const key of keys) {
              const keyLower = key.toLowerCase();
              if (!isMsalAccessTokenKey(keyLower)) continue;
              if (!keyLower.includes(marker)) continue;
              try {
                const value = store.getItem(key);
                addToken(extractTokenFromParsed(JSON.parse(value)));
              } catch (e) {}
            }
          }

          for (const key of keys) {
            const keyLower = key.toLowerCase();
            if (!isMsalAccessTokenKey(keyLower)) continue;
            if (!isPowerPlatformFlowTokenKey(keyLower)) continue;
            try {
              const value = store.getItem(key);
              addToken(extractTokenFromParsed(JSON.parse(value)));
            } catch (e) {}
          }

          for (const key of keys) {
            const keyLower = key.toLowerCase();
            if (!isMsalAccessTokenKey(keyLower)) continue;
            if (!flowMarkers.some((m) => keyLower.includes(m))) continue;
            try {
              const value = store.getItem(key);
              addToken(extractTokenFromParsed(JSON.parse(value)));
            } catch (e) {}
          }
        }

        scanStore(sessionStorage);
        scanStore(localStorage);
        return tokens;
      } catch (e) {
        return [];
      }
    },
  });

  return tokenResults?.[0]?.result ?? [];
}

async function collectRankedFlowTokens(tabId) {
  const raw = await collectRawFlowMsalTokens(tabId);
  return rankTokensForFlowApi(raw);
}

// Best guess access token for api.flow.microsoft.com (ranked).
async function getToken(tabId) {
  const ranked = await collectRankedFlowTokens(tabId);
  return ranked[0] ?? null;
}

/**
 * Fetch runs from the Power Automate tab’s MAIN world (portal Origin).
 * Uses credentials: "omit" because api.flow.microsoft.com may use
 * Access-Control-Allow-Origin: *, which breaks credentials: "include".
 * Retries with ranked Bearer tokens so the fallback still works without cookies.
 */
async function fetchRunsFromPageContext(tabId, environmentId, flowId, top = 10) {
  const ranked = await collectRankedFlowTokens(tabId);
  const tryList = ranked.length > 0 ? ranked : [null];

  let last = {
    success: false,
    error: "Could not run fetch in page context.",
  };

  for (const token of tryList) {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      args: [environmentId, flowId, top, token],
      func: async (environmentId, flowId, top, token) => {
        const apiUrl = `https://api.flow.microsoft.com/providers/Microsoft.ProcessSimple/environments/${environmentId}/flows/${flowId}/runs?api-version=2016-11-01&$top=${top}`;
        try {
          const headers = { Accept: "application/json" };
          if (typeof token === "string" && token.length > 0) {
            headers.Authorization = `Bearer ${token}`;
          }
          const response = await fetch(apiUrl, {
            method: "GET",
            credentials: "omit",
            headers,
          });
          if (!response.ok) {
            await response.text();
            return {
              success: false,
              error: `API error: ${response.status}`,
              status: response.status,
            };
          }
          const data = await response.json();
          return {
            success: true,
            runs: data.value || [],
            status: response.status,
          };
        } catch (error) {
          return { success: false, error: error.message };
        }
      },
    });

    last = results?.[0]?.result ?? last;
    if (last.success) return last;
    if (last.status && last.status !== 401 && last.status !== 403) {
      return last;
    }
  }

  return last;
}

// Get auth token from page and fetch runs (Bearer in worker, then portal-context fetch fallback)
async function fetchRunsWithToken(tabId, environmentId, flowId) {
  const apiUrl = `https://api.flow.microsoft.com/providers/Microsoft.ProcessSimple/environments/${environmentId}/flows/${flowId}/runs?api-version=2016-11-01&$top=10`;
  const ranked = await collectRankedFlowTokens(tabId);

  for (let ti = 0; ti < ranked.length; ti++) {
    const token = ranked[ti];
    try {
      const response = await fetch(apiUrl, {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${token}`,
        },
      });

      if (response.ok) {
        const data = await response.json();
        return { success: true, runs: data.value || [] };
      }
      await response.text();
      if (response.status !== 401 && response.status !== 403) {
        return { success: false, error: `API error: ${response.status}` };
      }
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  const fallback = await fetchRunsFromPageContext(tabId, environmentId, flowId, 10);
  if (fallback.success) {
    return { success: true, runs: fallback.runs };
  }

  if (ranked.length === 0) {
    return {
      success: false,
      error:
        fallback.error ||
        "Could not find auth token. Please refresh the page.",
    };
  }
  return {
    success: false,
    error: "Token expired. Please refresh the page.",
  };
}

// Fetch run actions/steps
async function fetchRunActions(tabId, environmentId, flowId, runId) {
  const ranked = await collectRankedFlowTokens(tabId);
  if (ranked.length === 0) {
    return { success: false, error: "Could not find auth token." };
  }

  const apiUrl = `https://api.flow.microsoft.com/providers/Microsoft.ProcessSimple/environments/${environmentId}/flows/${flowId}/runs/${runId}?api-version=2016-11-01&$expand=properties/actions`;

  try {
    for (const token of ranked) {
      const response = await fetch(apiUrl, {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${token}`,
        },
      });

      if (response.ok) {
        const data = await response.json();
        const actions = data.properties?.actions || {};

        const actionsList = Object.entries(actions)
          .map(([name, action]) => ({
            name: name,
            status: action.status,
            startTime: action.startTime,
            endTime: action.endTime,
            code: action.code,
            error: action.error,
            inputsLink: action.inputsLink || null,
            outputsLink: action.outputsLink || null,
          }))
          .sort((a, b) => {
            if (!a.startTime) return 1;
            if (!b.startTime) return -1;
            return new Date(a.startTime) - new Date(b.startTime);
          });

        return { success: true, actions: actionsList };
      }
      if (response.status !== 401 && response.status !== 403) {
        return { success: false, error: `API error: ${response.status}` };
      }
    }
    return {
      success: false,
      error: "Token expired. Please refresh the page.",
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// Cancel a running flow
async function cancelRun(tabId, environmentId, flowId, runId) {
  const ranked = await collectRankedFlowTokens(tabId);
  if (ranked.length === 0) {
    return { success: false, error: "Could not find auth token." };
  }

  const apiUrl = `https://api.flow.microsoft.com/providers/Microsoft.ProcessSimple/environments/${environmentId}/flows/${flowId}/runs/${runId}/cancel?api-version=2016-11-01`;

  try {
    for (const token of ranked) {
      const response = await fetch(apiUrl, {
        method: "POST",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${token}`,
        },
      });

      if (response.ok) {
        return { success: true };
      }
      if (response.status === 400) {
        return {
          success: false,
          error: "Run cannot be cancelled (may have already completed).",
        };
      }
      if (response.status !== 401 && response.status !== 403) {
        return { success: false, error: `API error: ${response.status}` };
      }
    }
    return {
      success: false,
      error: "Token expired. Please refresh the page.",
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// Resubmit a flow run
async function resubmitRun(tabId, environmentId, flowId, runId) {
  const ranked = await collectRankedFlowTokens(tabId);
  if (ranked.length === 0) {
    return { success: false, error: "Could not find auth token." };
  }

  const apiUrl = `https://api.flow.microsoft.com/providers/Microsoft.ProcessSimple/environments/${environmentId}/flows/${flowId}/triggers/manual/histories/${runId}/resubmit?api-version=2016-11-01`;

  try {
    for (const token of ranked) {
      const response = await fetch(apiUrl, {
        method: "POST",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${token}`,
        },
      });

      if (response.ok) {
        return { success: true };
      }
      if (response.status === 400) {
        return { success: false, error: "Run cannot be resubmitted." };
      }
      if (response.status !== 401 && response.status !== 403) {
        return { success: false, error: `API error: ${response.status}` };
      }
    }
    return {
      success: false,
      error: "Token expired. Please refresh the page.",
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// Fetch flow definition
async function fetchFlowDefinition(tabId, environmentId, flowId) {
  const ranked = await collectRankedFlowTokens(tabId);
  if (ranked.length === 0) {
    return { success: false, error: "Could not find auth token." };
  }

  const apiUrl = `https://api.flow.microsoft.com/providers/Microsoft.ProcessSimple/environments/${environmentId}/flows/${flowId}?api-version=2016-11-01`;

  try {
    for (const token of ranked) {
      const response = await fetch(apiUrl, {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${token}`,
        },
      });

      if (response.ok) {
        const data = await response.json();
        return { success: true, flow: data };
      }
      if (response.status !== 401 && response.status !== 403) {
        return { success: false, error: `API error: ${response.status}` };
      }
    }
    return {
      success: false,
      error: "Token expired. Please refresh the page.",
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// Run save-and-wait in the Flow Editor tab, then trigger the flow via API
async function runSaveAndTriggerFlow(tabId, environmentId, flowId) {
  const saveResults = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: () => {
      return new Promise((resolve) => {
        const saveButton = document.querySelector(
          '[data-automation-id="saveFlow"]',
        );
        if (!saveButton) {
          resolve({
            success: false,
            error: "Save button not found. Ensure you are in the Flow Editor.",
          });
          return;
        }
        saveButton.click();

        const errorSvgPath = "M10 2a8 8 0 1 1 0 16 8 8 0 0 1 0-16Z";
        // Fluent UI success checkmark (circle + check path); error icon has only the circle
        const successCheckmarkPath = "Zm3.36 5.65";
        let attempts = 0;
        const maxWait = 15;

        const interval = setInterval(() => {
          attempts += 1;

          const errorIcons = Array.from(
            document.querySelectorAll("svg"),
          ).filter((svg) => {
            if (svg.offsetParent === null) return false;
            const pathEl = svg.querySelector("path");
            const pathD = pathEl?.getAttribute("d") ?? svg.innerHTML;
            // Error icon has circle path but NOT the checkmark (success has both)
            return (
              pathD.includes(errorSvgPath) && !pathD.includes(successCheckmarkPath)
            );
          });
          if (errorIcons.length > 0) {
            clearInterval(interval);
            resolve({ success: false, error: "Error detected." });
            return;
          }

          const successIcons = Array.from(
            document.querySelectorAll("svg"),
          ).filter((svg) => {
            if (svg.offsetParent === null) return false;
            const pathEl = svg.querySelector("path");
            const pathD = pathEl?.getAttribute("d") ?? svg.innerHTML;
            return pathD.includes(successCheckmarkPath);
          });
          if (successIcons.length > 0) {
            clearInterval(interval);
            resolve({ success: true });
            return;
          }

          if (attempts >= maxWait) {
            clearInterval(interval);
            resolve({
              success: false,
              error: "Save did not complete in time.",
            });
          }
        }, 1000);
      });
    },
  });

  const saveResult = saveResults?.[0]?.result;
  if (!saveResult || !saveResult.success) {
    return { success: false, error: saveResult?.error || "Save failed." };
  }

  return triggerFlow(tabId, environmentId, flowId);
}

// Trigger a flow (start a new run) using Flow Management API
async function triggerFlow(tabId, environmentId, flowId) {
  const ranked = await collectRankedFlowTokens(tabId);
  if (ranked.length === 0) {
    return { success: false, error: "Could not find auth token." };
  }

  const baseUrl = `https://api.flow.microsoft.com/providers/Microsoft.ProcessSimple/environments/${environmentId}/flows/${flowId}?api-version=2016-11-01`;

  try {
    for (const token of ranked) {
      const detailsRes = await fetch(baseUrl, {
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${token}`,
        },
      });

      if (!detailsRes.ok) {
        if (detailsRes.status === 401 || detailsRes.status === 403) {
          continue;
        }
        return { success: false, error: `API error: ${detailsRes.status}` };
      }

      const details = await detailsRes.json();
      const triggerUri = details?.properties?.flowTriggerUri;

      if (!triggerUri) {
        return {
          success: false,
          error: "No trigger URI. Ensure this flow has a Manual or HTTP trigger.",
        };
      }

      const triggerRes = await fetch(triggerUri, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({}),
      });

      if (triggerRes.ok) {
        return { success: true };
      }
      if (triggerRes.status === 401 || triggerRes.status === 403) {
        continue;
      }
      const errorBody = await triggerRes.text();
      return {
        success: false,
        error: errorBody || `Trigger failed: ${triggerRes.status}`,
      };
    }
    return {
      success: false,
      error: "Token expired. Please refresh the page.",
    };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// Fetch action input/output content from pre-authenticated blob URI
async function fetchActionContent(contentUri) {
  if (!contentUri) {
    return { success: false, error: "No content URI provided" };
  }

  try {
    const response = await fetch(contentUri, {
      method: "GET",
      headers: { Accept: "application/json" },
    });

    if (!response.ok) {
      return { success: false, error: `HTTP ${response.status}` };
    }

    const data = await response.json();
    return { success: true, content: data };
  } catch (error) {
    return { success: false, error: error.message };
  }
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
    chrome.runtime
      .sendMessage({
        type: "ACTIVE_TAB_CHANGED",
        tabId: activeInfo.tabId,
        url: tab.url,
      })
      .catch(() => {});
  } catch (e) {
    // Ignore errors from tabs that may have been closed or are inaccessible
  }
});

// Enable side panel when clicking the action button
chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ tabId: tab.id });
});
