'use strict';

/**
 * Where the game prints the map/realm name, as a fraction of the frame.
 * 85% width: a narrower crop clips long titles that wrap onto a second line at
 * higher UI Scale settings (e.g. "Raccoon City Police Station" is one line at
 * 70% but wraps to two at 100%).
 *
 * Kept free of Electron so the crop-bounds tests and the dev scripts can share it.
 */
const MAP_NAME_ROI = { x: 0, y: 0.65, width: 0.85, height: 0.30 };

module.exports = { MAP_NAME_ROI };
