import {marked} from 'marked';
import DOMPurify from 'dompurify';

// Remote markdown (GitHub master) must never inject markup that runs code
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    // Links open externally (main's window-open handler routes them to
    // openExternal) and never navigate the app window itself.
    if (node.tagName === 'A' && node.hasAttribute('href')) {
        node.setAttribute('target', '_blank');
        node.setAttribute('rel', 'noopener noreferrer');
    }
});

export function renderMarkdown(markdown) {
    return DOMPurify.sanitize(marked.parse(String(markdown || '')));
}
