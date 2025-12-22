/**
 * <numr-calculator> - Lit Web Component
 *
 * A portable calculator widget powered by numr WASM engine.
 * Uses Light DOM for contenteditable compatibility with CodeJar.
 *
 * @example
 * <numr-calculator></numr-calculator>
 *
 * @example With initial content
 * <numr-calculator content="100 + 50\n* 2"></numr-calculator>
 *
 * @example Minimal mode (no header/footer)
 * <numr-calculator minimal></numr-calculator>
 *
 * @fires numr-ready - When WASM engine is initialized
 * @fires numr-change - When content changes, detail: { content, results, totals }
 *
 * @csspart header - The header element
 * @csspart editor - The editor grid container
 * @csspart footer - The footer element
 *
 * @cssprop --numr-bg-primary - Main background color
 * @cssprop --numr-bg-secondary - Secondary background (header/footer)
 * @cssprop --numr-text-primary - Main text color
 * @cssprop --numr-accent - Accent color (caret, highlights)
 */

import { LitElement, html, nothing } from "https://esm.sh/lit@3";
import { unsafeHTML } from "https://esm.sh/lit@3/directives/unsafe-html.js";
import { CodeJar } from "https://esm.sh/codejar@4.3.0";

// ============================================================================
// Constants
// ============================================================================

const VERSION = "0.3.1";
const STORAGE_KEY = "numr-document";
const RATES_KEY = "numr-rates";
const RATES_TIMESTAMP_KEY = "numr-rates-timestamp";
const RATES_CACHE_TTL = 60 * 60 * 1000; // 1 hour

const DEFAULT_CONTENT = `# Quick calculations
100 + 50
* 2                        // continuation from previous
_ / 3                      // _ references previous result

# Unit conversions
42 km to miles
100 F to C

# Currency (live rates)
100 USD in EUR
`;

const CRYPTO_IDS = {
  BTC: "bitcoin",
  ETH: "ethereum",
  SOL: "solana",
  USDT: "tether",
  USDC: "usd-coin",
  BNB: "binancecoin",
  XRP: "ripple",
  ADA: "cardano",
  DOGE: "dogecoin",
  DOT: "polkadot",
  LTC: "litecoin",
  LINK: "chainlink",
  AVAX: "avalanche-2",
  MATIC: "polygon-ecosystem-token",
  TON: "the-open-network",
};

// ============================================================================
// Styles (injected once per document)
// ============================================================================

const STYLES_ID = "numr-calculator-styles";

function injectStyles() {
  if (document.getElementById(STYLES_ID)) return;

  const style = document.createElement("style");
  style.id = STYLES_ID;
  style.textContent = `
    /* numr-calculator component styles */
    numr-calculator {
      display: block;
      height: 100%;
    }

    .numr-container {
      --_bg-primary: var(--numr-bg-primary, #1a1c1e);
      --_bg-secondary: var(--numr-bg-secondary, #1f2225);
      --_text-primary: var(--numr-text-primary, #e8eaed);
      --_text-secondary: var(--numr-text-secondary, #a8adb3);
      --_text-muted: var(--numr-text-muted, #6b7280);
      --_accent: var(--numr-accent, #a8b4f4);
      --_success: var(--numr-success, #7dd3a8);
      --_error: var(--numr-error, #f4a8a8);
      --_border: var(--numr-border, #2a2e32);
      --_font: var(--numr-font, ui-monospace, 'SF Mono', SFMono-Regular, 'Cascadia Code', Consolas, monospace);
      --_font-size: var(--numr-font-size, 14px);
      --_line-height: var(--numr-line-height, 1.5em);

      display: flex;
      flex-direction: column;
      height: 100%;
      font-family: var(--_font);
      font-size: var(--_font-size);
      line-height: var(--_line-height);
      background: var(--_bg-primary);
      color: var(--_text-primary);
      box-sizing: border-box;
    }

    .numr-container *, .numr-container *::before, .numr-container *::after {
      box-sizing: border-box;
    }

    /* Header */
    .numr-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      min-height: 2rem;
      padding: 0.25rem 0.5rem;
      background: var(--_bg-secondary);
      border-bottom: 1px solid var(--_border);
      flex-shrink: 0;
    }

    .numr-logo {
      font-weight: 600;
      color: var(--_text-secondary);
    }

    .numr-actions {
      display: flex;
      gap: 0.5rem;
    }

    .numr-btn {
      background: transparent;
      color: var(--_text-muted);
      border: none;
      cursor: pointer;
      padding: 0.25rem;
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: inherit;
    }

    .numr-btn:hover {
      color: var(--_accent);
    }

    .numr-btn.loading svg {
      animation: numr-spin 1s linear infinite;
    }

    .numr-btn.success {
      color: var(--_success);
    }

    .numr-btn.error {
      color: var(--_error);
    }

    @keyframes numr-spin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }

    /* Scroll wrapper */
    .numr-scroll-wrapper {
      flex: 1;
      overflow-y: auto;
      overflow-x: hidden;
      scrollbar-gutter: stable;
    }

    /* Editor grid */
    .numr-editor-grid {
      display: grid;
      grid-template-columns: auto 1fr auto;
      min-height: 100%;
    }

    /* Gutters */
    .numr-gutter {
      background: var(--_bg-primary);
      padding: 0.5rem;
      padding-bottom: 0;
    }

    .numr-line-numbers {
      border-right: 1px solid var(--_border);
      text-align: right;
      color: var(--_text-muted);
      user-select: none;
      min-width: calc(2ch + 14px + 1rem);
    }

    .numr-results {
      border-left: 1px solid var(--_border);
      text-align: right;
      width: max-content;
      padding-left: 1rem;
      padding-right: 1rem;
    }

    .numr-line {
      height: var(--_line-height);
      white-space: nowrap;
    }

    .numr-line.numr-error {
      color: var(--_error);
      cursor: help;
      position: relative;
      padding-left: 10px;
    }

    .numr-error-bullet {
      position: absolute;
      left: 0;
      top: 50%;
      transform: translateY(-50%);
      width: 6px;
      height: 6px;
      background: var(--_error);
      border-radius: 50%;
    }

    /* Editor */
    .numr-editor {
      background: var(--_bg-primary);
      padding: 0.5rem;
      padding-bottom: 0;
      font-family: var(--_font);
      font-size: var(--_font-size);
      line-height: var(--_line-height);
      tab-size: 2;
      white-space: pre !important;
      word-wrap: normal !important;
      overflow-x: auto;
      outline: none;
      caret-color: var(--_accent);
      cursor: text;
      min-height: 100%;
    }

    .numr-editor * {
      white-space: pre !important;
    }

    .numr-editor::selection,
    .numr-editor *::selection {
      background: rgba(174, 159, 242, 0.25);
    }

    /* Footer */
    .numr-footer {
      display: flex;
      justify-content: flex-end;
      align-items: center;
      gap: 0.5rem;
      min-height: 2rem;
      padding: 0.25rem 0.5rem;
      background: var(--_bg-secondary);
      border-top: 1px solid var(--_border);
      flex-shrink: 0;
    }

    .numr-footer:empty {
      min-height: 0;
      padding: 0;
      border: none;
    }

    .numr-total-label {
      color: var(--_text-muted);
    }

    .numr-total-value {
      color: var(--_success);
    }

    /* Token colors */
    .numr-token-number { color: #b898f4; }
    .numr-token-operator { color: #f47898; }
    .numr-token-variable { color: #f4a860; }
    .numr-token-unit { color: #A8B4F4; }
    .numr-token-currency { color: #f4c244; }
    .numr-token-keyword { color: #f47898; }
    .numr-token-function { color: #f4c244; }
    .numr-token-comment { color: #7d7868; font-style: italic; }
    .numr-token-text { color: #f4e878; }
    .numr-token-punctuation { color: #a8a498; }

    /* Readonly state */
    .numr-editor[contenteditable="false"] {
      cursor: default;
      user-select: text;
    }

    /* Loading state */
    .numr-loading {
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100%;
      color: var(--_text-muted);
    }

    .numr-loading-spinner {
      width: 20px;
      height: 20px;
      border: 2px solid var(--_border);
      border-top-color: var(--_accent);
      border-radius: 50%;
      animation: numr-spin 0.8s linear infinite;
      margin-right: 0.5rem;
    }

    /* Scrollbar */
    .numr-scroll-wrapper::-webkit-scrollbar { width: 8px; height: 8px; }
    .numr-scroll-wrapper::-webkit-scrollbar-track { background: var(--_bg-secondary); }
    .numr-scroll-wrapper::-webkit-scrollbar-thumb { background: var(--_border); }
  `;
  document.head.appendChild(style);
}

// ============================================================================
// WASM Module Loading (shared across instances)
// ============================================================================

let wasmPromise = null;
let WasmEngine = null;
let tokenizeFn = null;

async function loadWasm(basePath = "") {
  if (wasmPromise) return wasmPromise;

  wasmPromise = (async () => {
    const v = `?v=${VERSION}`;
    const corePath = basePath
      ? `${basePath}/pkg/core/numr_core.js${v}`
      : `./pkg/core/numr_core.js${v}`;
    const editorPath = basePath
      ? `${basePath}/pkg/editor/numr_editor.js${v}`
      : `./pkg/editor/numr_editor.js${v}`;

    const [coreModule, editorModule] = await Promise.all([
      import(corePath),
      import(editorPath),
    ]);

    await Promise.all([coreModule.default(), editorModule.default()]);

    WasmEngine = coreModule.WasmEngine;
    tokenizeFn = editorModule.tokenize;
  })();

  return wasmPromise;
}

// ============================================================================
// NumrCalculator Component
// ============================================================================

export class NumrCalculator extends LitElement {
  static properties = {
    content: { type: String },
    minimal: { type: Boolean },
    readonly: { type: Boolean },
    norates: { type: Boolean },
    autosave: { type: Boolean },
    storageKey: { type: String, attribute: "storage-key" },
    basePath: { type: String, attribute: "base-path" },
    _ready: { type: Boolean, state: true },
    _rateStatus: { type: String, state: true },
    _results: { type: Array, state: true },
    _totals: { type: Array, state: true },
  };

  constructor() {
    super();
    this.content = "";
    this.minimal = false;
    this.readonly = false;
    this.norates = false;
    this.autosave = false;
    this.storageKey = STORAGE_KEY;
    this.basePath = "";
    this._ready = false;
    this._rateStatus = "idle";
    this._results = [];
    this._totals = [];
    this._engine = null;
    this._jar = null;
    this._saveTimeout = null;
  }

  // Use Light DOM for contenteditable compatibility
  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    injectStyles();
    this._init();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this._saveTimeout) {
      clearTimeout(this._saveTimeout);
      // Flush pending save
      if (this.autosave && this._jar) {
        localStorage.setItem(this.storageKey, this._jar.toString());
      }
    }
    this._jar?.destroy();
    this._jar = null;
    this._engine?.free();
    this._engine = null;
  }

  // ============================================================================
  // Initialization
  // ============================================================================

  async _init() {
    try {
      await loadWasm(this.basePath);
      this._engine = new WasmEngine();

      // Load cached rates (skip if norates)
      if (!this.norates) {
        const timestamp = localStorage.getItem(RATES_TIMESTAMP_KEY);
        if (timestamp && Date.now() - parseInt(timestamp) < RATES_CACHE_TTL) {
          const cached = localStorage.getItem(RATES_KEY);
          if (cached) {
            this._engine.apply_rates(cached);
            this._rateStatus = "success";
          }
        } else {
          this._fetchRates();
        }
      }

      this._ready = true;
      this.requestUpdate();

      // Wait for render, then init CodeJar
      await this.updateComplete;
      this._initEditor();

      this.dispatchEvent(new CustomEvent("numr-ready", { bubbles: true }));
    } catch (e) {
      console.error("numr-calculator: Failed to initialize", e);
    }
  }

  _initEditor() {
    const editor = this.querySelector(".numr-editor");
    if (!editor) return;

    this._jar = CodeJar(editor, (el) => this._highlight(el), {
      tab: "  ",
      spellcheck: false,
      catchTab: false,
      preserveIdent: false,
      addClosing: true,
      autoclose: { open: "(", close: ")" },
    });

    // Load content
    const initialContent =
      this.content ||
      (this.autosave ? localStorage.getItem(this.storageKey) : null) ||
      DEFAULT_CONTENT;

    this._jar.updateCode(initialContent);
    this._jar.onUpdate(() => this._evaluate());
    this._evaluate();
  }

  // ============================================================================
  // Exchange Rates
  // ============================================================================

  async _fetchRates() {
    this._rateStatus = "loading";
    this.requestUpdate();

    try {
      const [fiat, crypto] = await Promise.all([
        fetch("https://open.er-api.com/v6/latest/USD")
          .then((r) => r.json())
          .then((d) => d.rates || {})
          .catch(() => ({})),
        fetch(
          `https://api.coingecko.com/api/v3/simple/price?ids=${Object.values(CRYPTO_IDS).join(",")}&vs_currencies=usd`,
        )
          .then((r) => r.json())
          .then((data) => {
            const rates = {};
            for (const [code, id] of Object.entries(CRYPTO_IDS)) {
              if (data[id]?.usd) rates[code] = data[id].usd;
            }
            return rates;
          })
          .catch(() => ({})),
      ]);

      const rates = { ...fiat, ...crypto };

      if (Object.keys(rates).length > 0) {
        const json = JSON.stringify(rates);
        this._engine.apply_rates(json);
        localStorage.setItem(RATES_KEY, json);
        localStorage.setItem(RATES_TIMESTAMP_KEY, Date.now().toString());
        this._rateStatus = "success";
        this._evaluate();
      } else {
        this._rateStatus = "error";
      }
    } catch (e) {
      console.warn("numr-calculator: Failed to fetch rates", e);
      this._rateStatus = "error";
    }

    this.requestUpdate();
  }

  // ============================================================================
  // Core Logic
  // ============================================================================

  _evaluate() {
    if (!this._engine || !this._jar) return;

    const content = this._jar.toString();

    if (this.autosave) {
      // Debounce localStorage writes
      if (this._saveTimeout) clearTimeout(this._saveTimeout);
      this._saveTimeout = setTimeout(() => {
        localStorage.setItem(this.storageKey, content);
      }, 300);
    }

    try {
      this._results = JSON.parse(this._engine.eval_document(content));
      this._totals = JSON.parse(this._engine.get_totals());
    } catch (e) {
      console.error("numr-calculator: Evaluation error", e);
      this._results = [];
      this._totals = [];
    }

    this.requestUpdate();

    this.dispatchEvent(
      new CustomEvent("numr-change", {
        bubbles: true,
        detail: { content, results: this._results, totals: this._totals },
      }),
    );
  }

  _highlight(editor) {
    const code = editor.textContent || "";
    if (!code || !tokenizeFn) {
      editor.innerHTML = this._escapeHtml(code) || "\n";
      return;
    }

    const knownVars = this._getKnownVariables();
    const lines = code.split("\n");

    const htmlContent = lines
      .map((line, i) => {
        if (!line) return i < lines.length - 1 ? "\n" : "";
        return (
          this._renderTokens(line, knownVars) +
          (i < lines.length - 1 ? "\n" : "")
        );
      })
      .join("");

    editor.innerHTML = htmlContent || "\n";
  }

  _getKnownVariables() {
    if (!this._engine) return null;
    try {
      const vars = JSON.parse(this._engine.get_variables());
      return new Set(vars.map((v) => v.name));
    } catch {
      return null;
    }
  }

  _renderTokens(text, knownVars = null) {
    if (!text || !tokenizeFn) return this._escapeHtml(text);

    try {
      const tokens = JSON.parse(tokenizeFn(text));
      let htmlContent = "";
      for (const t of tokens) {
        let type = t.token_type;
        if (type === "text" && knownVars?.has(t.text)) {
          type = "variable";
        }
        htmlContent +=
          type === "whitespace"
            ? this._escapeHtml(t.text)
            : `<span class="numr-token-${type}">${this._escapeHtml(t.text)}</span>`;
      }
      return htmlContent || this._escapeHtml(text);
    } catch {
      return this._escapeHtml(text);
    }
  }

  _escapeHtml(text) {
    if (!text) return "";
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  // ============================================================================
  // Public API
  // ============================================================================

  /** Get current content */
  getContent() {
    return this._jar?.toString() || "";
  }

  /** Set content programmatically */
  setContent(content) {
    this._jar?.updateCode(content);
  }

  /** Clear the document */
  clear() {
    this._engine?.clear();
    this._jar?.updateCode("");
    this._evaluate();
  }

  /** Refresh exchange rates */
  refreshRates() {
    if (this._rateStatus !== "loading") {
      this._fetchRates();
    }
  }

  /** Focus the editor */
  focus() {
    this.querySelector(".numr-editor")?.focus();
  }

  // ============================================================================
  // Render
  // ============================================================================

  render() {
    if (!this._ready) {
      return html`
        <div class="numr-container" part="container">
          <div class="numr-loading">
            <div class="numr-loading-spinner"></div>
            Loading...
          </div>
        </div>
      `;
    }

    const lineCount = this._jar?.toString().split("\n").length || 1;

    return html`
      <div class="numr-container" part="container">
        ${!this.minimal ? this._renderHeader() : nothing}

        <div class="numr-scroll-wrapper" part="editor">
          <div class="numr-editor-grid">
            <div class="numr-gutter numr-line-numbers">
              ${this._renderLineNumbers(lineCount)}
            </div>
            <div
              class="numr-editor"
              contenteditable="${this.readonly ? "false" : "true"}"
              spellcheck="false"
            ></div>
            <div class="numr-gutter numr-results">${this._renderResults()}</div>
          </div>
        </div>

        ${!this.minimal ? this._renderFooter() : nothing}
      </div>
    `;
  }

  _renderHeader() {
    return html`
      <header class="numr-header" part="header">
        <div class="numr-logo">numr</div>
        <div class="numr-actions">
          <button
            class="numr-btn ${this._rateStatus}"
            title="Refresh exchange rates"
            @click=${() => this.refreshRates()}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
              <path d="M21 3v5h-5" />
            </svg>
          </button>
        </div>
      </header>
    `;
  }

  _renderFooter() {
    if (!this._totals.length) {
      return html`<footer class="numr-footer" part="footer"></footer>`;
    }

    return html`
      <footer class="numr-footer" part="footer">
        <span class="numr-total-label">total:</span>
        ${this._totals.map(
          (t) => html`
            <span class="numr-total-value"
              >${unsafeHTML(this._renderTokens(t))}</span
            >
          `,
        )}
      </footer>
    `;
  }

  _renderLineNumbers(count) {
    const lines = [];
    for (let i = 1; i <= count; i++) {
      const r = this._results[i - 1];
      if (r?.is_error) {
        lines.push(html`
          <div class="numr-line numr-error" title="${r.result}">
            <span class="numr-error-bullet"></span>${i}
          </div>
        `);
      } else {
        lines.push(html`<div class="numr-line">${i}</div>`);
      }
    }
    return lines;
  }

  _renderResults() {
    return this._results.map((r) =>
      r.is_empty || r.is_error
        ? html`<div class="numr-line"></div>`
        : html`<div class="numr-line">
            ${unsafeHTML(this._renderTokens(r.result))}
          </div>`,
    );
  }
}

// Register the component
customElements.define("numr-calculator", NumrCalculator);
