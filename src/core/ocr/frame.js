'use strict';

/**
 * Frame helpers shared by the OCR service and the screen-state checks.
 *
 * A "frame" is either an encoded image Buffer (PNG fixtures, the dev CLI) or a
 * raw capture `{data, width, height, channels}` straight from node-screenshots
 * (RGBA, no PNG encode/decode round trip per tick). Every consumer goes through
 * `toSharp()`, so both shapes work everywhere.
 */

const sharp = require('sharp');

/** @returns {boolean} whether the frame is a raw pixel capture rather than an encoded image */
function isRawFrame(frame) {
    return !!frame && !Buffer.isBuffer(frame) && frame.data && Number.isInteger(frame.width) && Number.isInteger(frame.height);
}

/**
 * @param {Buffer|{data: Buffer|Uint8Array, width: number, height: number, channels?: number}} frame
 * @returns {import('sharp').Sharp}
 */
function toSharp(frame) {
    if (isRawFrame(frame)) {
        const channels = frame.channels || Math.round(frame.data.length / (frame.width * frame.height));
        return sharp(frame.data, { raw: { width: frame.width, height: frame.height, channels } });
    }
    return sharp(frame);
}

/** @returns {Promise<{width: number, height: number}>} */
async function frameSize(frame) {
    if (isRawFrame(frame)) return { width: frame.width, height: frame.height };
    const meta = await sharp(frame).metadata();
    return { width: meta.width || 0, height: meta.height || 0 };
}

/**
 * Turns a fractional ROI into a pixel rectangle that always lies inside the
 * frame. The origin is floored and the size clamped to what is left of the
 * frame: rounding both (the old code) pushed left+width one pixel past the edge
 * at widths like 1366 with x=0.75, which sharp rejects with "bad extract area".
 *
 * width/height default to "the rest of the frame", so {x: 0.75, y: 0.9} is the
 * bottom-right corner.
 *
 * @param {number} frameWidth
 * @param {number} frameHeight
 * @param {{x?: number, y?: number, width?: number, height?: number}} roi
 * @returns {{left: number, top: number, width: number, height: number}}
 */
function cropRect(frameWidth, frameHeight, roi) {
    const clamp01 = v => Math.min(Math.max(v || 0, 0), 1);
    const x = clamp01(roi.x);
    const y = clamp01(roi.y);
    const boxWidth = roi.width ?? (1 - x);
    const boxHeight = roi.height ?? (1 - y);
    const left = Math.min(Math.floor(frameWidth * x), Math.max(0, frameWidth - 1));
    const top = Math.min(Math.floor(frameHeight * y), Math.max(0, frameHeight - 1));
    return {
        left,
        top,
        width: Math.max(1, Math.min(Math.round(frameWidth * boxWidth), frameWidth - left)),
        height: Math.max(1, Math.min(Math.round(frameHeight * boxHeight), frameHeight - top)),
    };
}

/**
 * Crops a frame and converts it into the raw RGB pixels the OCR runtime
 * expects. Runs on sharp's thread pool, so it never blocks the event loop.
 * @param {Buffer|object} frame
 * @param {{x: number, y: number, width?: number, height?: number}} [roi]
 * @returns {Promise<{width: number, height: number, data: Buffer}>}
 */
async function framePixels(frame, roi) {
    let image = toSharp(frame);
    if (roi) {
        const { width, height } = await frameSize(frame);
        image = toSharp(frame).extract(cropRect(width, height, roi));
    }
    const { data, info } = await image
        .toColourspace('srgb')
        .removeAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
    return { width: info.width, height: info.height, data };
}

module.exports = { isRawFrame, toSharp, frameSize, cropRect, framePixels };
