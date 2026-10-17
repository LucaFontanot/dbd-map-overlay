const test = require('node:test');
const assert = require('node:assert');

const {createLogBuffer, installConsoleCapture, buildReport} = require('../src/core/logs');

test('log buffer keeps only the most recent lines and truncates long ones', () => {
    const buffer = createLogBuffer({max: 3, maxLineLength: 60});
    for (let i = 0; i < 5; i++) buffer.push('log', [`line ${i}`]);
    buffer.push('warn', ['x'.repeat(200)]);
    const lines = buffer.lines();
    assert.strictEqual(lines.length, 3);
    assert.match(lines[0], /\[log\] line 3$/);
    assert.match(lines[2], /\[warn\] x+\.\.\. \[truncated \d+ chars\]$/);
});

test('console capture records every level and still calls the original', () => {
    const printed = [];
    const target = {};
    for (const level of ['log', 'info', 'warn', 'error', 'debug']) target[level] = (...args) => printed.push([level, ...args]);
    const buffer = createLogBuffer();
    installConsoleCapture(target, buffer);
    target.log('MapDetector: %s', 'HUNTING', {n: 1});
    target.error(new Error('boom'));
    assert.strictEqual(printed.length, 2);
    const lines = buffer.lines();
    assert.match(lines[0], /\[log\] MapDetector: HUNTING \{ n: 1 \}$/);
    assert.match(lines[1], /\[error\] Error: boom/);
});

test('report has both logs and only the detector settings, never the token', () => {
    const report = buildReport({
        version: '1.7.0',
        settings: {token: 'secret-token', id: 42, ocrLanguage: 'eng', endgameDetection: false},
        rendererLog: '[DEBUG] window line',
        mainLines: ['main line'],
    });
    assert.match(report, /DBD Map Overlay 1\.7\.0/);
    assert.match(report, /"ocrLanguage":"eng"/);
    assert.match(report, /===== Main process =====\nmain line/);
    assert.match(report, /===== Window =====\n\[DEBUG\] window line/);
    assert.ok(!report.includes('secret-token'));
    assert.ok(!report.includes('"id"'));
});
