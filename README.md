# Power Automate Run History

A Chrome extension that displays run history for Power Automate Cloud Flows directly from the flow designer.

## Features

- **Side panel UI** - View run history alongside the flow designer
- **Last 10 runs** - Quick access to recent flow executions
- **Run details** - Status, timestamp, and duration for each run
- **One-click navigation** - Click any run to view its details
- **Auto-detection** - Automatically detects when you're viewing a flow

## Installation

1. Clone or download this repository
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable **Developer mode** (toggle in top right)
4. Click **Load unpacked**
5. Select the `power-automate-runs` folder

## Usage

1. Navigate to a Power Automate flow in the designer at `make.powerautomate.com`
2. Click the extension icon in the toolbar to open the side panel
3. View the run history for the current flow
4. Click any run to navigate to its detail page
5. Use the refresh button to reload the run list

**Note:** You must be signed in to Power Automate in your browser for the extension to work.

## How It Works

The extension detects when you're on a Power Automate flow designer page by matching the URL pattern:
```
https://make.powerautomate.com/environments/{environmentId}/flows/{flowId}/*
```

It then fetches run history from the Power Automate API using your existing browser session credentials.

## Files

| File | Description |
|------|-------------|
| `manifest.json` | Extension configuration (Manifest V3) |
| `background.js` | Service worker for API calls |
| `content.js` | Detects flow context from page URL |
| `sidepanel.html` | Side panel UI structure |
| `sidepanel.js` | Side panel logic and rendering |
| `sidepanel.css` | Styling |

## License

MIT
