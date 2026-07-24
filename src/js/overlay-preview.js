// Sample image shown on the overlay while the Overlay settings tab is open,
// so size/position/opacity/rotation changes can be previewed live without
// picking a real map first. Rendered once on a canvas and cached as base64
// PNG (the same format map-change already accepts).

const SIZE = 900;

let cachedPreview = null;

function loadIcon() {
    return new Promise((resolve) => {
        const icon = new Image();
        // icon missing is cosmetic only -- the preview still works without it
        icon.onload = () => resolve(icon);
        icon.onerror = () => resolve(null);
        icon.src = "images/icon.png";
    });
}

async function buildPreviewImage() {
    if (cachedPreview) return cachedPreview;

    const canvas = document.createElement("canvas");
    canvas.width = SIZE;
    canvas.height = SIZE;
    const ctx = canvas.getContext("2d");

    const bg = ctx.createRadialGradient(SIZE / 2, SIZE / 2, 100, SIZE / 2, SIZE / 2, SIZE * 0.75);
    bg.addColorStop(0, "#1d222e");
    bg.addColorStop(1, "#0c0e14");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, SIZE, SIZE);

    // Faint dot grid so the surface reads as textured, not flat
    ctx.fillStyle = "rgba(255, 255, 255, 0.06)";
    for (let y = 30; y < SIZE; y += 30) {
        for (let x = 30; x < SIZE; x += 30) {
            ctx.fillRect(x, y, 2, 2);
        }
    }

    // Frame keeps the overlay's edges visible while adjusting size/position
    ctx.strokeStyle = "rgba(255, 255, 255, 0.18)";
    ctx.lineWidth = 3;
    ctx.strokeRect(20, 20, SIZE - 40, SIZE - 40);

    // Diagonal watermark so it can never be mistaken for a real map
    ctx.save();
    ctx.translate(SIZE / 2, SIZE / 2);
    ctx.rotate(-Math.PI / 4);
    ctx.fillStyle = "rgba(255, 255, 255, 0.05)";
    ctx.font = "bold 150px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("PREVIEW", 0, 55);
    ctx.restore();

    const icon = await loadIcon();
    if (icon) {
        const iconSize = 520;
        ctx.save();
        ctx.shadowColor = "rgba(120, 160, 255, 0.5)";
        ctx.shadowBlur = 40;
        ctx.drawImage(icon, (SIZE - iconSize) / 2, 90, iconSize, iconSize);
        ctx.restore();
    }

    ctx.textAlign = "center";
    ctx.fillStyle = "#e8e2d0";
    ctx.font = "bold 90px Georgia, serif";
    ctx.fillText("DBD Map Overlay", SIZE / 2, 730);

    cachedPreview = canvas.toDataURL("image/png").split(",")[1];
    return cachedPreview;
}

module.exports = {buildPreviewImage};
