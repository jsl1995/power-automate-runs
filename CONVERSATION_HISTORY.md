# Power Automate Run History Extension - Development Conversation

## Initial Request

**User**: I would like to make a chrome browser extension for Chrome in which I can view the run history and click through to runs for a Power Automate Cloud Flow when in the flow designer.

## Requirements Gathering

Through discussion, the following requirements were established:

- **UI**: Chrome Side Panel (persistent alongside flow designer)
- **Data**: Last 10 runs with status, timestamp, and duration
- **Action**: Click to navigate to run detail page
- **Scope**: Only active when on Power Automate flow designer pages

## Architecture

```
power-automate-runs/
├── manifest.json          # Manifest V3 configuration
├── background.js          # Service worker for API calls
├── sidepanel.html         # Side panel UI
├── sidepanel.js           # Side panel logic
├── sidepanel.css          # Styling
├── content.js             # Content script to detect flow context
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

## Implementation Timeline

### Phase 1: Basic Extension Setup

Created the initial extension with:
- Manifest V3 configuration
- Content script to detect flow context from URL
- Background service worker for API communication
- Side panel UI with run list

### Phase 2: GitHub Repository

- Installed GitHub CLI via homebrew
- User authenticated with `gh auth login`
- Created repository: https://github.com/jsl1995/power-automate-runs
- Added README.md

### Phase 3: Power Apps Domain Support

**Issue**: Extension only worked on `make.powerautomate.com`, not `make.powerapps.com`

**Fix**: Added `powerapps.com` to manifest host permissions and content script matches.

### Phase 4: Authentication Issues

**Issue 1**: 401 Unauthorized errors - background script couldn't use page session cookies

**Attempted Fix**: Injected script approach - blocked by CORS

**Final Solution**: Extract bearer token from sessionStorage/localStorage (where MSAL stores tokens) and use Authorization header in API requests from background script.

**Issue 2**: Wrong token extracted initially

**Fix**: Prioritize tokens with `flow.microsoft.com`, `service.flow.microsoft.com`, or `api.flow.microsoft.com` in the storage key.

### Phase 5: Return to Flow Editor Button

**User Request**: Add a "Return to Flow Editor" button to navigate back to the flow after viewing a run.

**Implementation**: Added button that displays whenever a flow context is available, storing the flow editor URL.

### Phase 6: Expandable Run Details

**User Request**: Add expand/collapse functionality to show flow steps with success/failure indicators.

**Implementation**:
- Added expand button with chevron icon
- Fetch actions via API: `/runs/{runId}?$expand=properties/actions`
- Display steps with tick (✓) or cross (✕) based on status
- Cache loaded actions to avoid refetching

### Phase 7: Double-Click Navigation

**User Request**: Double-click anywhere on a row (except expand button) to open run details.

**Implementation**: Added `dblclick` event handler on run items.

### Phase 8: Platform Switch Buttons

**User Request**: Add Power Apps and Power Automate logo buttons to switch between platforms.

**Implementation**:
- Added platform buttons with SVG logos
- Power Apps button: navigates to `make.powerapps.com`
- Power Automate button: navigates to `make.powerautomate.com`
- "Return to Flow Editor" returns to original site

### Phase 9: Power Apps URL Pattern Support

**Issue**: Power Apps uses different URL patterns:
- Flow editor: `/solutions/{solutionId}/objects/cloudflows/{flowId}`
- Not: `/flows/{flowId}`

**Fixes**:
1. Updated content.js regex to match both patterns
2. Extract and preserve `solutionId` from URL
3. Save `solutionId` across navigation (since not all URLs contain it)

### Phase 10: Correct URL Patterns for Each Platform

**Issue**: Clicking runs on Power Apps navigated to wrong page

**Solution**:
- Power Apps runs: `/solutions/{solutionId}/objects/cloudflows/{flowId}/runs/{runId}`
- Power Automate runs: `/flows/{flowId}/runs/{runId}`

## Key Technical Details

### URL Patterns

| Platform | Flow Editor | Run Details |
|----------|-------------|-------------|
| Power Automate | `/environments/{envId}/flows/{flowId}` | `/environments/{envId}/flows/{flowId}/runs/{runId}` |
| Power Apps | `/environments/{envId}/solutions/{solId}/objects/cloudflows/{flowId}` | `/environments/{envId}/solutions/{solId}/objects/cloudflows/{flowId}/runs/{runId}` |

### API Endpoints

- **List runs**: `https://api.flow.microsoft.com/providers/Microsoft.ProcessSimple/environments/{envId}/flows/{flowId}/runs?api-version=2016-11-01&$top=10`
- **Run with actions**: `https://api.flow.microsoft.com/providers/Microsoft.ProcessSimple/environments/{envId}/flows/{flowId}/runs/{runId}?api-version=2016-11-01&$expand=properties/actions`

### Token Extraction

MSAL stores tokens in sessionStorage/localStorage with keys containing the resource scope. The extension searches for tokens with these scopes:
- `flow.microsoft.com`
- `service.flow.microsoft.com`
- `api.flow.microsoft.com`

Token format: `{ secret: "token..." }` or `{ accessToken: "token..." }`

## Issues Encountered and Solutions

| Issue | Cause | Solution |
|-------|-------|----------|
| 401 Unauthorized | Background script can't use page cookies | Extract bearer token from storage |
| CORS errors | Page context fetch blocked | Make fetch from background script |
| Wrong token | Multiple tokens in storage | Prioritize Flow API scoped tokens |
| Not working on Power Apps | Only matched powerautomate.com | Added powerapps.com to manifest |
| cloudflows not recognized | Different URL pattern | Added regex for `/objects/cloudflows/` |
| Solution ID lost | Not in all URLs | Save and preserve across navigation |
| Wrong page on run click | Used wrong URL pattern | Platform-specific URL construction |

## Files Modified

1. **manifest.json** - Extension configuration, permissions, content script matches
2. **content.js** - URL pattern detection, context extraction including solutionId
3. **background.js** - Token extraction, API calls, tab context management
4. **sidepanel.js** - UI logic, platform-aware URL construction, expandable runs
5. **sidepanel.html** - UI structure with back button, platform buttons
6. **sidepanel.css** - Styling for all UI components

## How to Install

1. Go to `chrome://extensions/`
2. Enable "Developer mode"
3. Click "Load unpacked"
4. Select the `power-automate-runs` folder
5. Navigate to a Power Automate or Power Apps flow
6. Click the extension icon or use Chrome's side panel menu

## Repository

https://github.com/jsl1995/power-automate-runs
