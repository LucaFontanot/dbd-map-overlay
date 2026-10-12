// Overlay and OBS windows: show the bytes main sends. The OBS window only
// receives (bytes, size); the overlay also gets opacity, draggable, rotation.
import './overlay.css';

const img = document.getElementById('map');
let url = null;

function hide() {
    img.hidden = true;
}

window.overlay.onMapChange((bytes, size, opacity, draggable, rotation) => {
    if (url !== null) {
        URL.revokeObjectURL(url);
        url = null;
    }
    // An empty payload means "hidden" (hideOverlay setting)
    if (!bytes || bytes.length === 0) {
        hide();
    } else {
        url = URL.createObjectURL(new Blob([bytes]));
        img.src = url;
        img.hidden = false;
    }
    img.style.width = `${size}px`;
    if (opacity !== undefined) img.style.opacity = opacity;
    img.style.transform = `rotate(${rotation || 0}deg)`;
    document.body.style.webkitAppRegion = draggable ? 'drag' : 'no-drag';
});

window.overlay.onMapHide(hide);
