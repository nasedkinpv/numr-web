/**
 * numr web - Calculator Application
 *
 * Architecture:
 * - WASM engine (numr-core) handles evaluation
 * - WASM tokenizer (numr-editor) handles syntax highlighting
 * - CodeJar for contenteditable editor
 * - Vanilla JS for DOM manipulation and event handling
 *
 * No frameworks - just simple, readable code.
 */

import { CodeJar } from 'https://esm.sh/codejar@4.3.0';

// ============================================================================
// Constants
// ============================================================================

const STORAGE_KEY = 'numr-document';
const RATES_KEY = 'numr-rates';
const RATES_TIMESTAMP_KEY = 'numr-rates-timestamp';
const RATES_CACHE_TTL = 60 * 60 * 1000; // 1 hour
const WASM_ASSET_VERSION = '818e648755';
const ANALYTICS_FLUSH_DELAY_MS = 1000;
const ANALYTICS_MAX_FLUSH_ATTEMPTS = 10;
const SHARE_HASH_PATTERN = /^n1\.(r|z)\.([A-Za-z0-9_-]+)$/;
const SHARE_DEFAULT_TITLE = 'Share document link';
const SHARE_NATIVE_TITLE = 'numr document';
const SHARE_NATIVE_TEXT = 'Shared from numr';
const SHARE_URL_SOFT_LIMIT = 8000;
const SHARE_URL_HARD_LIMIT = 64000;
const SHARE_RESET_DELAY_MS = 3000;
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

// Example content shown when localStorage is empty
const EXAMPLE_CONTENT = `# Quick calculations
100 + 50
* 2                        // continuation from previous
_ / 3                      // _ references previous result

# Variables
price = 49.99
quantity = 3
total = price * quantity
+ 15%                      // add tax

# Unit conversions
42 km to miles
100 F to C
2.5 hours to minutes

# Currency (live rates)
1000 USD in EUR
0.1 BTC in USD
`;


// Cryptocurrency IDs for CoinGecko API
const CRYPTO_IDS = {
    BTC: 'bitcoin', ETH: 'ethereum', SOL: 'solana', USDT: 'tether',
    USDC: 'usd-coin', BNB: 'binancecoin', XRP: 'ripple', ADA: 'cardano',
    DOGE: 'dogecoin', DOT: 'polkadot', LTC: 'litecoin', LINK: 'chainlink',
    AVAX: 'avalanche-2', MATIC: 'polygon-ecosystem-token', TON: 'the-open-network'
};

// ============================================================================
// State
// ============================================================================

let engine = null;      // WASM evaluation engine
let tokenizeFn = null;  // WASM tokenizer function
let jar = null;         // CodeJar editor instance

// DOM element references (populated in init)
const $ = {
    editor: null,
    lineNumbers: null,
    results: null,
    totals: null,
    btnRates: null,
    btnShare: null,
    btnNew: null,
    btnSave: null,
    btnLoad: null,
    fileInput: null,
};

// Rate fetch status
let rateStatus = 'idle'; // 'idle' | 'loading' | 'success' | 'error'
let shareStatusTimer = null;
const analyticsState = {
    initialSource: 'example',
    pendingEvents: [],
    flushAttempts: 0,
    flushTimer: null,
    editorEngagedTracked: false,
};

// ============================================================================
// Initialization
// ============================================================================

/**
 * Initialize WASM modules and fetch exchange rates
 */
async function initWasm() {
    const v = `?v=${WASM_ASSET_VERSION}`;
    const [coreModule, editorModule] = await Promise.all([
        import(`./pkg/core/numr_core.js${v}`),
        import(`./pkg/editor/numr_editor.js${v}`)
    ]);

    await Promise.all([
        coreModule.default(new URL(`./pkg/core/numr_core_bg.wasm${v}`, import.meta.url)),
        editorModule.default(new URL(`./pkg/editor/numr_editor_bg.wasm${v}`, import.meta.url))
    ]);

    engine = new coreModule.WasmEngine();
    tokenizeFn = editorModule.tokenize;

    // Try to load cached rates first
    const timestamp = localStorage.getItem(RATES_TIMESTAMP_KEY);
    if (timestamp && Date.now() - parseInt(timestamp) < RATES_CACHE_TTL) {
        const cached = localStorage.getItem(RATES_KEY);
        if (cached) {
            engine.apply_rates(cached);
            updateRateStatus('success', timestamp);
            return;
        }
    }

    // Fetch fresh rates
    await fetchRates('auto');
}

/**
 * Fetch exchange rates from APIs and apply to engine
 */
async function fetchRates(source = 'auto') {
    updateRateStatus('loading');

    try {
        const [fiat, crypto] = await Promise.all([
            // Fiat rates from open.er-api.com
            fetch('https://open.er-api.com/v6/latest/USD')
                .then(r => r.json())
                .then(d => d.rates || {})
                .catch(() => ({})),

            // Crypto rates from CoinGecko
            fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${Object.values(CRYPTO_IDS).join(',')}&vs_currencies=usd`)
                .then(r => r.json())
                .then(data => {
                    const rates = {};
                    for (const [code, id] of Object.entries(CRYPTO_IDS)) {
                        if (data[id]?.usd) rates[code] = data[id].usd;
                    }
                    return rates;
                })
                .catch(() => ({}))
        ]);

        const rates = { ...fiat, ...crypto };

        if (Object.keys(rates).length > 0) {
            const json = JSON.stringify(rates);
            const now = Date.now().toString();
            engine.apply_rates(json);
            localStorage.setItem(RATES_KEY, json);
            localStorage.setItem(RATES_TIMESTAMP_KEY, now);
            updateRateStatus('success', now);
            if (source === 'manual') {
                trackEvent('Rates Refreshed');
            }

            // Re-evaluate to apply new rates
            evaluate();
        } else {
            updateRateStatus('error');
            if (source === 'manual') {
                trackEvent('Rates Refresh Failed');
            }
        }
    } catch (e) {
        console.warn('Failed to fetch rates:', e);
        updateRateStatus('error');
        if (source === 'manual') {
            trackEvent('Rates Refresh Failed');
        }
    }
}

/**
 * Main initialization - called on page load
 */
async function init() {
    // Cache DOM references
    $.editor = document.getElementById('editor');
    $.lineNumbers = document.getElementById('line-numbers');
    $.results = document.getElementById('results');
    $.totals = document.getElementById('totals');
    $.btnRates = document.getElementById('btn-rates');
    $.btnShare = document.getElementById('btn-share');
    $.btnNew = document.getElementById('btn-new');
    $.btnSave = document.getElementById('btn-save');
    $.btnLoad = document.getElementById('btn-load');
    $.fileInput = document.getElementById('file-input');
    updateShareStatus('idle');

    // Initialize WASM (includes rate fetching)
    try {
        await initWasm();
    } catch (e) {
        console.error('Failed to initialize WASM:', e);
        $.editor.textContent = '# Error: Failed to load calculator engine.\n# Please refresh the page.';
        return;
    }

    // Initialize CodeJar with syntax highlighting
    jar = CodeJar($.editor, highlight, {
        tab: '  ',
        spellcheck: false,
        catchTab: false,       // Allow tab to move focus (more natural for calculator)
        preserveIdent: false,  // Calculator doesn't need indentation
        addClosing: true,      // Auto-close parentheses
        autoclose: {
            open: '(',
            close: ')',
        },
    });

    // Load shared content first, then localStorage/example fallback
    const initialContent = await getInitialContent();
    jar.updateCode(initialContent);

    // Listen for changes
    jar.onUpdate(() => evaluate());
    $.editor.addEventListener('input', trackEditorEngagement, { passive: true });

    // Initial render
    evaluate();

    // Focus editor
    $.editor.focus();

    // Setup button event listeners
    setupEventListeners();

    // Initialize Lucide icons
    if (window.lucide) {
        lucide.createIcons();
    }
}

// ============================================================================
// Syntax Highlighting (for CodeJar)
// ============================================================================

/**
 * Highlight function for CodeJar - applies syntax highlighting via WASM tokenizer
 */
function highlight(editor) {
    const code = editor.textContent || '';

    if (!code || !tokenizeFn) {
        editor.innerHTML = escapeHtml(code) || '\n';
        return;
    }

    // Get known variable names for enhanced highlighting
    const knownVars = getKnownVariables();

    const lines = code.split('\n');
    const html = lines.map((line, i) => {
        if (!line) return i < lines.length - 1 ? '\n' : '';
        return renderTokens(line, knownVars) + (i < lines.length - 1 ? '\n' : '');
    }).join('');

    editor.innerHTML = html || '\n';
}

/**
 * Get set of known variable names from engine
 */
function getKnownVariables() {
    if (!engine) return null;
    try {
        const vars = JSON.parse(engine.get_variables());
        return new Set(vars.map(v => v.name));
    } catch {
        return null;
    }
}

// ============================================================================
// Event Handling
// ============================================================================

function setupEventListeners() {
    $.btnRates.addEventListener('click', () => {
        if (rateStatus !== 'loading') fetchRates('manual');
    });
    $.btnShare?.addEventListener('click', shareDocument);
    $.btnNew.addEventListener('click', newDocument);
    $.btnSave.addEventListener('click', saveFile);
    $.btnLoad.addEventListener('click', () => $.fileInput.click());
    $.fileInput.addEventListener('change', loadFile);
}

// ============================================================================
// Core Logic
// ============================================================================

/**
 * Evaluate document and update all UI elements
 */
function evaluate() {
    if (!engine || !jar) return;

    const content = jar.toString();
    const lines = content.split('\n');

    // Save to localStorage
    localStorage.setItem(STORAGE_KEY, content);

    // Evaluate all lines via WASM engine
    let results = [];
    try {
        results = JSON.parse(engine.eval_document(content));
    } catch (e) {
        console.error('Evaluation error:', e);
    }

    // Update UI
    renderLineNumbers(lines.length, results);
    renderResults(results);
    renderFooter();
}

// ============================================================================
// Rendering
// ============================================================================

/**
 * Render line numbers in left gutter (with error bullets like VS Code)
 */
function renderLineNumbers(count, results) {
    let html = '';
    for (let i = 1; i <= count; i++) {
        const r = results[i - 1];
        if (r && r.is_error) {
            html += `<div class="line error" title="${escapeHtml(r.result)}"><span class="error-bullet"></span>${i}</div>`;
        } else {
            html += `<div class="line">${i}</div>`;
        }
    }
    $.lineNumbers.innerHTML = html;
}

/**
 * Render results in right gutter (with syntax highlighting)
 */
function renderResults(results) {
    $.results.innerHTML = results.map(r =>
        r.is_empty || r.is_error
            ? '<div class="line"></div>'
            : `<div class="line">${renderTokens(r.result)}</div>`
    ).join('');
}

/**
 * Render footer (totals with syntax highlighting)
 */
function renderFooter() {
    let totals = [];
    try {
        totals = JSON.parse(engine.get_totals());
    } catch {}

    $.totals.innerHTML = totals.length > 0
        ? `<span class="total-label">total:</span> ${totals.map(renderTokens).join('&nbsp;&nbsp;')}`
        : '';
}

// ============================================================================
// File Operations
// ============================================================================

function newDocument() {
    const content = jar.toString();
    if (content && !confirm('Create new document? Unsaved changes will be lost.')) {
        return;
    }
    if (content.trim()) {
        trackEvent('New Document Created', {
            previous_source: analyticsState.initialSource,
            ...getDocumentMetrics(content),
        });
    }
    jar.updateCode('');
    engine?.clear();
    analyticsState.initialSource = 'new_document';
    evaluate();
    $.editor.focus();
}

function saveFile() {
    const content = jar.toString();
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = 'calculations.numr';
    a.click();

    URL.revokeObjectURL(url);
    trackEvent('File Downloaded', {
        source: analyticsState.initialSource,
        ...getDocumentMetrics(content),
    });
}

function loadFile(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
        const loadedContent = typeof e.target?.result === 'string' ? e.target.result : '';
        jar.updateCode(loadedContent);
        analyticsState.initialSource = 'file_import';
        evaluate();
        $.editor.focus();
        trackEvent('File Imported', {
            file_extension: getFileExtension(file.name),
            file_size_bucket: getByteBucket(file.size),
            ...getDocumentMetrics(loadedContent),
        });
    };
    reader.readAsText(file);

    // Reset input so same file can be loaded again
    event.target.value = '';
}

async function shareDocument() {
    if (!jar) return;

    updateShareStatus('loading', 'Preparing link...');

    try {
        const content = jar.toString();
        const hashPayload = encodeContentForHash(content);
        const shareUrl = buildShareUrl(hashPayload);

        if (shareUrl.length > SHARE_URL_HARD_LIMIT) {
            updateShareStatus('error', 'Link is too large. Use Download');
            trackEvent('Share Link Too Large', {
                source: analyticsState.initialSource,
                link_size_bucket: getLinkSizeBucket(shareUrl.length),
                ...getDocumentMetrics(content),
            });
            return;
        }

        window.history.replaceState(null, '', `#${hashPayload}`);

        const nativeShareResult = await tryNativeShare(shareUrl);
        if (nativeShareResult === 'success') {
            trackShareCreated('native', shareUrl, content);
            updateShareStatus('success', 'Shared');
            return;
        }
        if (nativeShareResult === 'aborted') {
            updateShareStatus('idle');
            return;
        }

        const copied = await copyText(shareUrl);
        if (copied) {
            trackShareCreated('clipboard', shareUrl, content);
            updateShareStatus('success', getShareStatusMessage(shareUrl.length, true));
            return;
        }

        const manualCopy = window.prompt('Copy this share URL:', shareUrl);
        if (manualCopy === null) {
            updateShareStatus('idle');
            return;
        }

        trackShareCreated('manual', shareUrl, content);
        updateShareStatus('success', getShareStatusMessage(shareUrl.length, false));
    } catch (error) {
        console.warn('Failed to create share link:', error);
        updateShareStatus('error', 'Failed to create share link');
    }
}

function buildShareUrl(hashPayload) {
    return `${window.location.origin}${window.location.pathname}${window.location.search}#${hashPayload}`;
}

function getShareStatusMessage(urlLength, copied) {
    if (urlLength > SHARE_URL_SOFT_LIMIT) {
        return copied
            ? `Large link copied (${urlLength} chars)`
            : `Large link ready (${urlLength} chars)`;
    }
    return copied ? 'Link copied' : 'Link ready';
}

async function tryNativeShare(url) {
    if (typeof navigator.share !== 'function') return 'unsupported';

    try {
        await navigator.share({
            title: SHARE_NATIVE_TITLE,
            text: SHARE_NATIVE_TEXT,
            url,
        });
        return 'success';
    } catch (error) {
        if (error?.name === 'AbortError') {
            return 'aborted';
        }
        return 'failed';
    }
}

async function getInitialContent() {
    const sharedContent = await readContentFromHash();
    if (sharedContent !== null) {
        analyticsState.initialSource = 'share_link';
        return sharedContent;
    }
    const saved = localStorage.getItem(STORAGE_KEY);
    analyticsState.initialSource = saved ? 'local_storage' : 'example';
    return saved || EXAMPLE_CONTENT;
}

async function readContentFromHash() {
    const parsed = parseShareHash(window.location.hash);
    if (!parsed) return null;

    try {
        const content = await decodeContentFromHash(parsed.mode, parsed.payload);
        trackEvent('Shared Link Opened', {
            format: parsed.mode,
            ...getDocumentMetrics(content),
        });
        return content;
    } catch (error) {
        console.warn('Failed to decode shared link:', error);
        updateShareStatus('error', 'Invalid share link');
        trackEvent('Shared Link Invalid', { format: parsed.mode });
        window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
        return null;
    }
}

function parseShareHash(hash) {
    if (!hash) return null;
    const value = hash.startsWith('#') ? hash.slice(1) : hash;
    const match = SHARE_HASH_PATTERN.exec(value);
    if (!match) return null;
    return { mode: match[1], payload: match[2] };
}

function encodeContentForHash(content) {
    const rawBytes = textEncoder.encode(content);
    return `n1.r.${toBase64Url(rawBytes)}`;
}

async function decodeContentFromHash(mode, payload) {
    const bytes = fromBase64Url(payload);

    if (mode === 'r') {
        return textDecoder.decode(bytes);
    }

    if (mode === 'z') {
        const decompressedBytes = await decompressBytes(bytes);
        if (!decompressedBytes) {
            throw new Error('Compressed share links are not supported in this browser');
        }
        return textDecoder.decode(decompressedBytes);
    }

    throw new Error(`Unsupported share format: ${mode}`);
}

function toBase64Url(bytes) {
    const chunkSize = 0x8000;
    let binary = '';

    for (let i = 0; i < bytes.length; i += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
    }

    return btoa(binary)
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/g, '');
}

function fromBase64Url(base64url) {
    const normalized = base64url
        .replace(/-/g, '+')
        .replace(/_/g, '/');

    const padding = normalized.length % 4 === 0
        ? ''
        : '='.repeat(4 - (normalized.length % 4));

    const binary = atob(normalized + padding);
    const bytes = new Uint8Array(binary.length);

    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }

    return bytes;
}

async function decompressBytes(bytes) {
    if (typeof DecompressionStream !== 'function') return null;

    try {
        const stream = new DecompressionStream('deflate');
        const writer = stream.writable.getWriter();
        await writer.write(bytes);
        await writer.close();
        const buffer = await new Response(stream.readable).arrayBuffer();
        return new Uint8Array(buffer);
    } catch {
        throw new Error('Share link payload is corrupted');
    }
}

async function copyText(text) {
    if (navigator.clipboard?.writeText && window.isSecureContext) {
        try {
            await navigator.clipboard.writeText(text);
            return true;
        } catch {
            // Fall back to execCommand below.
        }
    }

    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    textarea.style.pointerEvents = 'none';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();

    let copied = false;
    try {
        copied = document.execCommand('copy');
    } catch {
        copied = false;
    } finally {
        document.body.removeChild(textarea);
    }

    return copied;
}

function updateShareStatus(status, title = SHARE_DEFAULT_TITLE) {
    if (!$.btnShare) return;

    $.btnShare.classList.remove('loading', 'success', 'error');

    if (shareStatusTimer) {
        clearTimeout(shareStatusTimer);
        shareStatusTimer = null;
    }

    if (status === 'loading') {
        $.btnShare.classList.add('loading');
        $.btnShare.title = title;
        return;
    }

    if (status === 'success' || status === 'error') {
        $.btnShare.classList.add(status);
        $.btnShare.title = title;
        shareStatusTimer = setTimeout(() => {
            $.btnShare.classList.remove('success', 'error');
            $.btnShare.title = SHARE_DEFAULT_TITLE;
            shareStatusTimer = null;
        }, SHARE_RESET_DELAY_MS);
        return;
    }

    $.btnShare.title = title;
}

function trackEditorEngagement() {
    if (analyticsState.editorEngagedTracked) return;

    analyticsState.editorEngagedTracked = true;
    trackEvent('Editor Engaged', {
        source: analyticsState.initialSource,
        ...getDocumentMetrics(jar?.toString() || ''),
    });
}

function trackShareCreated(method, shareUrl, content) {
    trackEvent('Share Link Created', {
        method,
        source: analyticsState.initialSource,
        link_size_bucket: getLinkSizeBucket(shareUrl.length),
        ...getDocumentMetrics(content),
    });
}

function trackEvent(name, data = undefined) {
    const payload = sanitizeAnalyticsData(data);
    if (sendTrackedEvent(name, payload)) return;

    if (analyticsState.pendingEvents.length >= 32) return;
    analyticsState.pendingEvents.push({ name, payload });
    scheduleAnalyticsFlush();
}

function sendTrackedEvent(name, payload) {
    const track = window.umami?.track;
    if (typeof track !== 'function') return false;

    try {
        if (payload && Object.keys(payload).length > 0) {
            track(name, payload);
        } else {
            track(name);
        }
        return true;
    } catch {
        return false;
    }
}

function scheduleAnalyticsFlush() {
    if (analyticsState.flushTimer || analyticsState.flushAttempts >= ANALYTICS_MAX_FLUSH_ATTEMPTS) {
        return;
    }

    analyticsState.flushTimer = window.setTimeout(flushAnalyticsQueue, ANALYTICS_FLUSH_DELAY_MS);
}

function flushAnalyticsQueue() {
    analyticsState.flushTimer = null;

    if (!analyticsState.pendingEvents.length) return;
    if (typeof window.umami?.track !== 'function') {
        analyticsState.flushAttempts += 1;
        if (analyticsState.flushAttempts >= ANALYTICS_MAX_FLUSH_ATTEMPTS) {
            analyticsState.pendingEvents = [];
            return;
        }
        scheduleAnalyticsFlush();
        return;
    }

    analyticsState.flushAttempts = 0;
    const pendingEvents = analyticsState.pendingEvents.splice(0);
    for (const event of pendingEvents) {
        sendTrackedEvent(event.name, event.payload);
    }
}

function sanitizeAnalyticsData(data) {
    if (!data) return undefined;

    const entries = Object.entries(data).filter(([, value]) =>
        value !== undefined && value !== null && value !== ''
    );

    return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function getDocumentMetrics(content) {
    const length = content.length;
    const lineCount = content ? content.split('\n').length : 0;

    return {
        content_bucket: getContentBucket(length),
        line_bucket: getLineBucket(lineCount),
    };
}

function getContentBucket(length) {
    if (length === 0) return 'empty';
    if (length <= 80) return '1-80';
    if (length <= 300) return '81-300';
    if (length <= 1500) return '301-1500';
    return '1500+';
}

function getLineBucket(lineCount) {
    if (lineCount === 0) return '0';
    if (lineCount <= 1) return '1';
    if (lineCount <= 5) return '2-5';
    if (lineCount <= 20) return '6-20';
    if (lineCount <= 50) return '21-50';
    return '50+';
}

function getByteBucket(byteCount) {
    if (byteCount <= 1024) return '0-1kb';
    if (byteCount <= 10 * 1024) return '1-10kb';
    if (byteCount <= 64 * 1024) return '10-64kb';
    return '64kb+';
}

function getLinkSizeBucket(length) {
    if (length <= 1000) return '0-1k';
    if (length <= 4000) return '1k-4k';
    if (length <= 8000) return '4k-8k';
    return '8k+';
}

function getFileExtension(filename) {
    const parts = filename.toLowerCase().split('.');
    return parts.length > 1 ? parts.pop() : 'unknown';
}

// ============================================================================
// Utilities
// ============================================================================

/**
 * Escape HTML special characters to prevent XSS
 */
function escapeHtml(text) {
    if (!text) return '';
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

/**
 * Render tokens as syntax-highlighted HTML
 * Enhances tokenization by highlighting known variable references
 */
function renderTokens(text, knownVars = null) {
    if (!text || !tokenizeFn) return escapeHtml(text);

    try {
        const tokens = JSON.parse(tokenizeFn(text));
        let html = '';
        for (const t of tokens) {
            // Promote "text" tokens to "variable" if they match a known variable
            let type = t.token_type;
            if (type === 'text' && knownVars?.has(t.text)) {
                type = 'variable';
            }
            html += type === 'whitespace'
                ? escapeHtml(t.text)
                : `<span class="token-${type}">${escapeHtml(t.text)}</span>`;
        }
        return html || escapeHtml(text);
    } catch {
        return escapeHtml(text);
    }
}

/**
 * Format timestamp as relative time (e.g., "5m", "1h")
 */
function formatTime(timestamp) {
    const mins = Math.floor((Date.now() - timestamp) / 60000);
    if (mins < 1) return 'now';
    if (mins < 60) return `${mins}m`;
    return `${Math.floor(mins / 60)}h`;
}

/**
 * Update rate button visual status
 */
function updateRateStatus(status, timestamp = null) {
    rateStatus = status;
    if (!$.btnRates) return;

    $.btnRates.classList.remove('loading', 'success', 'error');

    switch (status) {
        case 'loading':
            $.btnRates.classList.add('loading');
            $.btnRates.title = 'Loading rates...';
            break;
        case 'success':
            $.btnRates.classList.add('success');
            $.btnRates.title = `Rates updated: ${timestamp ? formatTime(parseInt(timestamp)) : 'now'}`;
            break;
        case 'error':
            $.btnRates.classList.add('error');
            $.btnRates.title = 'Failed to load rates';
            break;
        default:
            $.btnRates.title = 'Refresh exchange rates';
    }
}

// ============================================================================
// Start
// ============================================================================

init();
