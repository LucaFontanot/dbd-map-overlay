const {ipcRenderer} = require("electron");
const debugLogEnabled = true // Set to false to disable debug logging
const logs = []

module.exports.debugLog = function (...args) {
    if (!debugLogEnabled) {
        return
    }
    console.debug.apply(null, args)
    let logEntry = `[DEBUG] ${new Date().toISOString()} - `
    for (const entry of args) {
        if (typeof entry === 'object' || Array.isArray(entry)) {
            logEntry += `${JSON.stringify(entry, null, 2)} `
        } else {
            logEntry += `${entry} `
        }
    }
    logs.push(logEntry.trim())
}

module.exports.downloadLogs = function () {
    if (logs.length === 0) {
        alert('No logs to download.')
        return
    }

    const blob = new Blob([logs.join('\n')], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `debug_logs_${new Date().toISOString()}.txt`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
}

ipcRenderer.on('debug-log', async (event, message) => {
    module.exports.debugLog("icpRenderer::debug", message)
});