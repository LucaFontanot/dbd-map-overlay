// App-level UI state: current view, loading veil, notifications.
import {reactive} from 'vue';

export const ui = reactive({
    view: 'maps',
    settingsTab: 'general',
    // Gallery creator filter (also remaps the live overlay, see player.js)
    galleryCreator: '',
    loading: {active: false, text: ''},
    snackbar: {show: false, text: '', color: 'surface-variant', timeout: 5000},
    info: {version: '', platform: '', wayland: false},
    pageVisible: !document.hidden,
});

export function notify(text, color = 'surface-variant', timeout = 5000) {
    Object.assign(ui.snackbar, {show: true, text, color, timeout});
}

/** Runs `task` behind the loading veil. */
export async function withLoading(text, task) {
    ui.loading.active = true;
    ui.loading.text = text;
    try {
        return await task();
    } finally {
        ui.loading.active = false;
        ui.loading.text = '';
    }
}

document.addEventListener('visibilitychange', () => {
    ui.pageVisible = !document.hidden;
});
