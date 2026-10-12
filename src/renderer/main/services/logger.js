const debugLogEnabled = true; // Set to false to disable debug logging
// Ring buffer: the app runs for hours, keep only the most recent entries
const MAX_LOG_ENTRIES = 2000;
const MAX_ENTRY_LENGTH = 500;
const logs = [];

export function debugLog(...args) {
    if (!debugLogEnabled) return;
    console.debug(...args);
    let logEntry = `[DEBUG] ${new Date().toISOString()} - `;
    for (const entry of args) {
        if (typeof entry === 'object' && entry !== null) {
            let json;
            try {
                json = JSON.stringify(entry, null, 2);
            } catch (e) {
                json = String(entry);
            }
            logEntry += `${json} `;
        } else {
            logEntry += `${entry} `;
        }
    }
    logEntry = logEntry.trim();
    if (logEntry.length > MAX_ENTRY_LENGTH) {
        logEntry = logEntry.slice(0, MAX_ENTRY_LENGTH) + `... [truncated ${logEntry.length - MAX_ENTRY_LENGTH} chars]`;
    }
    logs.push(logEntry);
    if (logs.length > MAX_LOG_ENTRIES) logs.splice(0, logs.length - MAX_LOG_ENTRIES);
}

/** @returns {boolean} false when there is nothing to download */
export function downloadLogs() {
    if (logs.length === 0) return false;
    const blob = new Blob([logs.join('\n')], {type: 'text/plain'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `debug_logs_${new Date().toISOString()}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    return true;
}
