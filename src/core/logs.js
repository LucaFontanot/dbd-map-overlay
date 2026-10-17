'use strict';

/**
 * Main-process log capture + the Settings → General → "Debug log" export.
 *
 * The detector, OCR engine, sync and API all log from main with console.*,
 * which a packaged app never shows anywhere. installConsoleCapture() keeps the
 * most recent lines in a ring buffer, and `logs:save` writes them, together
 * with the renderer's own buffer, to one file in the Downloads folder and
 * reveals it. The old renderer-only blob download opened Electron's default
 * save dialog, which a fullscreen game hides, and never contained main's lines.
 */

const util = require('util');
const path = require('path');
const fs = require('fs');
const os = require('os');

const MAX_LINES = 5000;
const MAX_LINE_LENGTH = 1000;
/** Upper bound for the renderer's log (2000 entries × 500 chars, plus slack). */
const MAX_RENDERER_LOG = 2 * 1024 * 1024;
/** Settings that explain detector behaviour; never the token or ids. */
const REPORTED_SETTINGS = ['mapDetection', 'ocrLanguage', 'endgameDetection', 'detectInCustoms', 'preferredCreator'];

function createLogBuffer({max = MAX_LINES, maxLineLength = MAX_LINE_LENGTH} = {}) {
    const lines = [];
    return {
        push(level, args) {
            let line = `${new Date().toISOString()} [${level}] ${util.format(...args)}`;
            if (line.length > maxLineLength) {
                line = `${line.slice(0, maxLineLength)}... [truncated ${line.length - maxLineLength} chars]`;
            }
            lines.push(line);
            if (lines.length > max) lines.splice(0, lines.length - max);
        },
        lines: () => lines.slice(),
    };
}

const mainLog = createLogBuffer();
let installed = false;

/** Mirrors console.log/info/warn/error/debug into the ring buffer; output is unchanged. */
function installConsoleCapture(target = console, buffer = mainLog) {
    if (target === console && installed) return;
    if (target === console) installed = true;
    for (const level of ['log', 'info', 'warn', 'error', 'debug']) {
        const original = target[level].bind(target);
        target[level] = (...args) => {
            try {
                buffer.push(level, args);
            } catch {
                // never let logging break the caller
            }
            original(...args);
        };
    }
}

/**
 * @param {{version: string, settings: object, rendererLog: string, mainLines: string[]}} parts
 * @returns {string} the report written to disk
 */
function buildReport({version, settings, rendererLog, mainLines}) {
    const picked = {};
    for (const key of REPORTED_SETTINGS) picked[key] = settings ? settings[key] : undefined;
    return [
        `DBD Map Overlay ${version} debug log, ${new Date().toISOString()}`,
        `Platform: ${process.platform} ${os.release()} ${process.arch}, Electron ${process.versions.electron || '-'}`,
        `Settings: ${JSON.stringify(picked)}`,
        '',
        '===== Main process =====',
        ...mainLines,
        '',
        '===== Window =====',
        rendererLog || '(empty)',
        '',
    ].join('\n');
}

/** Registers `logs:save`: (rendererLog: string) → saved file path. */
function registerLogIpc(settings) {
    const {ipcMain, app, shell} = require('electron');
    ipcMain.handle('logs:save', async (event, rendererLog) => {
        if (typeof rendererLog !== 'string') throw new Error('logs:save: invalid log');
        if (rendererLog.length > MAX_RENDERER_LOG) rendererLog = rendererLog.slice(-MAX_RENDERER_LOG);
        const report = buildReport({
            version: app.getVersion(),
            settings: settings.forRenderer(),
            rendererLog,
            mainLines: mainLog.lines(),
        });
        const name = `dbd-map-overlay-log-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`;
        let dir;
        try {
            dir = app.getPath('downloads');
            fs.mkdirSync(dir, {recursive: true});
        } catch {
            dir = app.getPath('userData');
        }
        const file = path.join(dir, name);
        await fs.promises.writeFile(file, report, 'utf-8');
        console.log(`logs: debug log saved to ${file}`);
        shell.showItemInFolder(file);
        return file;
    });
}

module.exports = {createLogBuffer, installConsoleCapture, buildReport, registerLogIpc, mainLog};
