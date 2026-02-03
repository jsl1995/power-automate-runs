# Privacy Policy for Flow Run Buddy

**Last Updated:** February 3, 2026

## Overview

Flow Run Buddy is a browser extension that displays run history for Power Automate Cloud Flows. This privacy policy explains how the extension handles your data.

## Data Collection

**Flow Run Buddy does not collect, store, or transmit any personal data.**

The extension operates entirely within your browser and communicates only with Microsoft's Power Automate APIs using your existing authenticated session.

## Data Usage

The extension accesses the following data solely to provide its functionality:

- **Page URL**: Used to detect when you're viewing a Power Automate flow and extract the environment and flow identifiers
- **Authentication tokens**: Retrieved from your browser's session storage to authenticate API requests to Microsoft's Power Automate service. These tokens are never stored or transmitted anywhere except to Microsoft's official APIs.
- **Flow run history**: Retrieved from Microsoft's Power Automate API and displayed in the side panel. This data is not stored or cached beyond your current browser session.

## Third-Party Services

The extension communicates only with:
- `https://make.powerautomate.com` - Microsoft Power Automate portal
- `https://make.powerapps.com` - Microsoft Power Apps portal
- `https://api.flow.microsoft.com` - Microsoft Power Automate API

No data is sent to any other third-party services.

## Permissions

The extension requires the following browser permissions:

| Permission | Purpose |
|------------|---------|
| `activeTab` | Access the current tab to detect flow context from the URL |
| `scripting` | Extract authentication tokens from the page's session storage |
| `sidePanel` | Display the run history panel alongside the page |
| `storage` | Store extension state (no personal data) |

## Data Security

- All communication with Microsoft APIs uses HTTPS encryption
- Authentication tokens remain in your browser and are only used for API requests
- No data is stored on external servers

## Changes to This Policy

Any changes to this privacy policy will be posted on this page with an updated revision date.

## Contact

If you have questions about this privacy policy, please open an issue on the [GitHub repository](https://github.com/jsl1995/power-automate-runs).

## Open Source

Flow Run Buddy is open source. You can review the complete source code at:
https://github.com/jsl1995/power-automate-runs
