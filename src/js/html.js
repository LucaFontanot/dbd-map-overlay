// Minimal HTML escaping for strings interpolated into template HTML
// (map/realm/creator names come from file names and the remote catalog).
const HTML_ESCAPES = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
    '`': '&#96;',
};

function escapeHtml(value) {
    if (value === null || value === undefined) return '';
    return String(value).replace(/[&<>"'`]/g, ch => HTML_ESCAPES[ch]);
}

module.exports = {escapeHtml};
