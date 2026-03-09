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
const WASM_ASSET_VERSION = '0.5.2';
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
    await fetchRates();
}

/**
 * Fetch exchange rates from APIs and apply to engine
 */
async function fetchRates() {
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

            // Re-evaluate to apply new rates
            evaluate();
        } else {
            updateRateStatus('error');
        }
    } catch (e) {
        console.warn('Failed to fetch rates:', e);
        updateRateStatus('error');
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
        if (rateStatus !== 'loading') fetchRates();
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
    jar.updateCode('');
    engine?.clear();
    evaluate();
    $.editor.focus();
}

function saveFile() {
    const blob = new Blob([jar.toString()], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = 'calculations.numr';
    a.click();

    URL.revokeObjectURL(url);
}

function loadFile(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
        jar.updateCode(e.target.result);
        evaluate();
        $.editor.focus();
    };
    reader.readAsText(file);

    // Reset input so same file can be loaded again
    event.target.value = '';
}

async function shareDocument() {
    if (!jar) return;

    updateShareStatus('loading', 'Preparing link...');

    try {
        const hashPayload = encodeContentForHash(jar.toString());
        const shareUrl = buildShareUrl(hashPayload);

        if (shareUrl.length > SHARE_URL_HARD_LIMIT) {
            updateShareStatus('error', 'Link is too large. Use Download');
            return;
        }

        window.history.replaceState(null, '', `#${hashPayload}`);

        const nativeShareResult = await tryNativeShare(shareUrl);
        if (nativeShareResult === 'success') {
            updateShareStatus('success', 'Shared');
            return;
        }
        if (nativeShareResult === 'aborted') {
            updateShareStatus('idle');
            return;
        }

        const copied = await copyText(shareUrl);
        if (copied) {
            updateShareStatus('success', getShareStatusMessage(shareUrl.length, true));
            return;
        }

        const manualCopy = window.prompt('Copy this share URL:', shareUrl);
        if (manualCopy === null) {
            updateShareStatus('idle');
            return;
        }

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
        return sharedContent;
    }
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved || EXAMPLE_CONTENT;
}

async function readContentFromHash() {
    const parsed = parseShareHash(window.location.hash);
    if (!parsed) return null;

    try {
        return await decodeContentFromHash(parsed.mode, parsed.payload);
    } catch (error) {
        console.warn('Failed to decode shared link:', error);
        updateShareStatus('error', 'Invalid share link');
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
