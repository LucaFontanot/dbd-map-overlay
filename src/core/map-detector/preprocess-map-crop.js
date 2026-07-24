'use strict';

const sharp = require('sharp');

/**
 * Preprocesses the map/realm-name crop for Tesseract: 2x upscale, greyscale, a
 * fairly heavy blur, then a high threshold. Busy map-reveal backgrounds (grass,
 * foliage) turn into a mess of noise speckles without the blur; the high
 * threshold keeps just the bright white text instead of the whole noisy image.
 *
 * @param {Buffer} pngBuffer
 * @param {number} width  crop width before upscaling
 * @param {number} height crop height before upscaling
 * @returns {Promise<Buffer>}
 */
async function preprocessMapCrop(pngBuffer, width, height) {
    return sharp(pngBuffer)
        .resize(width * 2, height * 2, { kernel: sharp.kernel.lanczos3 })
        .greyscale()
        .blur(1.2)
        .threshold(220)
        .png()
        .toBuffer();
}

module.exports = { preprocessMapCrop };
