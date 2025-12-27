import { DEBUG } from './config.js';

export function log(...args) {
    if (DEBUG) {
        console.log(...args);
    }
}

export function warn(...args) {
    if (DEBUG) {
        console.warn(...args);
    }
}

export function error(...args) {
    // 错误信息总是显示
    console.error(...args);
}

// 通用转义与高亮工具
export function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (ch) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    }[ch] || ch));
}

export function escapeRegExp(str) {
    return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function highlightText(text, query) {
    if (!query) return escapeHtml(text);
    const pattern = new RegExp(escapeRegExp(query), 'gi');
    let lastIndex = 0;
    let result = '';
    text.replace(pattern, (match, offset) => {
        result += escapeHtml(text.slice(lastIndex, offset));
        result += `<span class="search-highlight">${escapeHtml(match)}</span>`;
        lastIndex = offset + match.length;
    });
    result += escapeHtml(text.slice(lastIndex));
    return result;
}

export function formatTime(seconds) {
    if (isNaN(seconds) || seconds < 0) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}
