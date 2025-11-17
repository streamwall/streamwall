# Stream Auto-Check Feature

## Overview
The "Auto-Check Streams" button allows you to quickly test all configured streams to determine which ones are currently live/accessible and which are offline or unavailable.

## Features

### Single Stream Check
```javascript
// Check a single stream
const isLive = await window.streamwallControl.checkStream(url);
// Returns: true if accessible, false if not
```

### Batch Stream Check (Used by Auto-Check Button)
```javascript
// Check multiple streams with delays to prevent rate limiting
const results = await window.streamwallControl.checkStreamsBatch(urls, 1500);
// Returns: { "url1": true, "url2": false, ... }
```

## How Auto-Check Works

1. **Button Location**: Settings panel > "Auto-Check Streams" button (blue button next to refresh buttons)

2. **Process**:
   - Collects all unique stream URLs from your configuration
   - Checks each stream sequentially with a 1.5-second delay between checks
   - For HLS streams (.m3u8): Fetches the playlist to verify availability
   - For other URLs: Sends a HEAD request to check reachability
   - Times out after 5 seconds per stream

3. **Results**:
   - Shows an alert with summary: ✓ Live count and ✗ Offline count
   - Logs detailed results to browser console

4. **Progress**:
   - Button text shows progress: "Checking... (5/23)"
   - Button is disabled during checks to prevent concurrent requests

## Rate Limiting Prevention

✅ **Built-in Safeguards**:
- Sequential checking (never concurrent)
- 1.5-second delays between requests
- Proper User-Agent headers
- Respects server timeouts

⚠️ **Best Practices**:
- Don't run checks more than once per minute on the same streams
- Cache results for at least 5 minutes before re-checking
- Consider checking during off-peak hours for large stream lists
- Check only streams that aren't currently being viewed

## Stream Availability Fields

Once checked, streams get an `isLive` property:
- `isLive: true` - Stream is accessible/live
- `isLive: false` - Stream is offline/unavailable  
- `isLive: undefined` - Not yet checked

This field can be used for sorting and filtering:
- **Live** section: Confirmed accessible streams
- **Unknown** section: Not yet checked
- **Offline** section: Confirmed unavailable

## Technical Details

### Checked From
- Main process IPC handler: `src/main/ControlWindow.ts`
- Utility functions: `src/util.ts`
- Preload API: `src/preload/controlPreload.ts`

### HLS Stream Detection
Checks if URL ends with `.m3u8` or `.m3u` to determine stream type.

### Timeout Handling
- Default: 5 seconds per stream
- Failed checks return `false` without throwing errors
- Network errors are handled gracefully

## Example Usage

### From Browser Console
```javascript
// Check one stream
await window.streamwallControl.checkStream('https://example.com/stream.m3u8');
// true

// Check multiple streams
const urls = [
  'https://example.com/stream1.m3u8',
  'https://example.com/stream2.m3u8'
];
const results = await window.streamwallControl.checkStreamsBatch(urls, 2000);
console.log(results);
// { "https://example.com/stream1.m3u8": true, "https://example.com/stream2.m3u8": false }
```

### From Settings Panel
- Click the blue "Auto-Check Streams" button
- Wait for the check to complete
- View results in the alert and console

## Troubleshooting

### Button is disabled/grayed out
- You may not have permissions to check streams
- Or streams haven't loaded yet

### Timeout errors
- Network connectivity issue
- Stream server is too slow to respond
- Try checking again or increase timeout (if needed)

### Too many failures
- Servers may have rate limited you
- Wait 5-10 minutes before trying again
- Consider checking fewer streams at a time

## Future Enhancements

Potential improvements:
- Auto-save `isLive` status to local storage
- Periodic background checks (with user opt-in)
- Visual indicators for stream status in the grid
- Configurable timeout and delay values
- Export results to CSV/JSON
