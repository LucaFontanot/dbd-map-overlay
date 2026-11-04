// Overlay and OBS windows: show the bytes main sends. The OBS window only
// receives (bytes, size); the overlay also gets opacity, draggable, rotation
// and layout ({box, align} from main: frame size and which edge it hugs).
import './overlay.css';

const img = document.getElementById('map');
// Only the overlay page has the frame; OBS keeps the plain centered image
const frame = document.getElementById('frame');
const FLEX = {start: 'flex-start', center: 'center', end: 'flex-end'};
let url = null;

function hide() {
    img.hidden = true;
}

// Loaded by an OBS Browser Source over http (no Electron preload): same
// messages, delivered by Server-Sent Events from src/core/obs-server.js.
const browserSource = !window.overlay;
if (browserSource) {
    document.body.classList.add('browser');
    const listeners = {};
    window.overlay = {
        onMapChange: (fn) => { listeners.change = fn; },
        onMapHide: (fn) => { listeners.hide = fn; },
    };
    const source = new EventSource('/events');
    source.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        if (msg.event === 'map-hide') return listeners.hide && listeners.hide();
        const bytes = msg.image ? Uint8Array.from(atob(msg.image), (c) => c.charCodeAt(0)) : new Uint8Array(0);
        if (listeners.change) listeners.change(bytes, msg.size);
    };
}

window.overlay.onMapChange((bytes, size, opacity, draggable, rotation, layout) => {
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
    // Browser Source: the map scales to the OBS source box (see overlay.css),
    // the app's pixel size only applies to the Electron windows
    if (!browserSource) img.style.width = `${size}px`;
    if (opacity !== undefined) img.style.opacity = opacity;
    img.style.transform = `rotate(${rotation || 0}deg)`;
    if (frame && layout) {
        frame.style.width = `${layout.box.width}px`;
        frame.style.height = `${layout.box.height}px`;
        document.body.style.justifyContent = FLEX[layout.align.x] || 'center';
        document.body.style.alignItems = FLEX[layout.align.y] || 'center';
    }
    document.body.style.webkitAppRegion = draggable ? 'drag' : 'no-drag';
});

window.overlay.onMapHide(hide);
