/**
 * Portable <numr-calculator> custom element.
 *
 * Public attributes, events, methods, and CSS parts are intentionally kept
 * stable while the implementation shares the standalone NumrEditor runtime.
 */

import { NumrEditor } from "../shared/numr-editor.js";
import { NumrSession } from "../shared/numr-session.js";
import { RatesService } from "../shared/rates-service.js";
import { renderTokenTotals } from "../shared/token-view.js";

const VERSION = __NUMR_ASSET_VERSION__;
const STORAGE_KEY = "numr-document";
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

const COMPONENT_STYLES = `
  :host {
    display: block;
    height: 100%;
    min-width: 0;
    min-height: 0;
  }

  *, *::before, *::after { box-sizing: border-box; }

  .container {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    background: var(--numr-bg-primary);
    color: var(--numr-text-primary);
    font-family: var(--numr-font-mono, var(--numr-font, ui-monospace, 'SF Mono', SFMono-Regular, 'Cascadia Code', Consolas, monospace));
    font-size: var(--numr-font-size, 14px);
    line-height: var(--numr-line-height, 1.5em);
  }

  header, footer {
    display: flex;
    align-items: center;
    min-height: 2rem;
    padding: 0.25rem 0.5rem;
    flex: none;
    background: var(--numr-bg-secondary);
  }

  header {
    justify-content: space-between;
    border-bottom: 1px solid var(--numr-border);
  }

  footer {
    justify-content: flex-start;
    border-top: 1px solid var(--numr-border);
    overflow-x: auto;
    white-space: pre;
  }

  footer > :first-child { margin-left: auto; }

  footer:empty {
    min-height: 0;
    padding: 0;
    border: 0;
  }

  .minimal header, .minimal footer { display: none; }
  .logo { color: var(--numr-text-muted); font-weight: 600; }

  button {
    display: grid;
    place-items: center;
    padding: 0.25rem;
    border: 0;
    background: transparent;
    color: var(--numr-text-muted);
    cursor: pointer;
  }

  button:hover { color: var(--numr-accent); }
  button.loading { cursor: wait; opacity: 0.7; }
  button.loading svg { animation: spin 1s linear infinite; }
  button.success { color: var(--numr-success); }
  button.error { color: var(--numr-error); }

  @keyframes spin { to { transform: rotate(360deg); } }

  .editor {
    flex: 1;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
  }

  .loading-view {
    display: grid;
    place-items: center;
    height: 100%;
    color: var(--numr-text-muted);
  }

  .total-label { color: var(--numr-text-muted); }
  .numr-token-number { color: #b898f4; }
  .numr-token-operator, .numr-token-keyword { color: #f47898; }
  .numr-token-variable { color: #f4a860; }
  .numr-token-unit { color: #a8b4f4; }
  .numr-token-currency, .numr-token-function { color: #f4c244; }
  .numr-token-comment { color: #7d7868; font-style: italic; }
  .numr-token-text { color: #f4e878; }
  .numr-token-punctuation { color: #a8a498; }
`;

function booleanProperty(attribute) {
	return {
		get() {
			return this.hasAttribute(attribute);
		},
		set(value) {
			this.toggleAttribute(attribute, Boolean(value));
		},
	};
}

export class NumrCalculator extends HTMLElement {
	static observedAttributes = [
		"content",
		"minimal",
		"readonly",
		"norates",
		"autosave",
		"storage-key",
		"base-path",
	];

	constructor() {
		super();
		this.attachShadow({ mode: "open" });
		this._generation = 0;
		this._ready = false;
		this._rateStatus = "idle";
		this._editor = null;
		this._session = null;
		this._ratesService = null;
		this._saveTimer = null;
	}

	get content() {
		return this._editor?.getContent() ?? this.getAttribute("content") ?? "";
	}

	set content(value) {
		this.setAttribute("content", String(value ?? ""));
	}

	get storageKey() {
		return this.getAttribute("storage-key") || STORAGE_KEY;
	}

	set storageKey(value) {
		this.setAttribute("storage-key", String(value || STORAGE_KEY));
	}

	get basePath() {
		return this.getAttribute("base-path") || "";
	}

	set basePath(value) {
		this.setAttribute("base-path", String(value || ""));
	}

	connectedCallback() {
		this._renderLoading();
		this._initialize(++this._generation);
	}

	disconnectedCallback() {
		this._generation += 1;
		this._disposeRuntime();
	}

	attributeChangedCallback(name, oldValue, newValue) {
		if (oldValue === newValue) return;

		if (name === "content" && this._editor) {
			this._editor.setContent(newValue || "");
		} else if (name === "readonly") {
			this._editor?.setReadOnly(this.readonly);
		} else if (name === "minimal") {
			this.shadowRoot
				?.querySelector(".container")
				?.classList.toggle("minimal", this.minimal);
		} else if (name === "base-path" && this.isConnected && this._ready) {
			this._restart();
		} else if (name === "norates" && this._ready && !this.norates) {
			this._initializeRates();
		} else if (name === "autosave" && !this.autosave && this._saveTimer) {
			clearTimeout(this._saveTimer);
			this._saveTimer = null;
		}
	}

	async _restart() {
		const content = this.getContent();
		const generation = ++this._generation;
		this._disposeRuntime();
		this._renderLoading();
		await this._initialize(generation, content);
	}

	async _initialize(generation, restoredContent = null) {
		try {
			const session = await NumrSession.create({
				basePath: this.basePath,
				version: VERSION,
			});
			if (!this.isConnected || generation !== this._generation) {
				session.dispose();
				return;
			}

			this._session = session;
			this._ratesService = new RatesService(session);
			this._renderReady();

			const saved = this.autosave
				? localStorage.getItem(this.storageKey)
				: null;
			const initialContent =
				restoredContent ?? this.getAttribute("content") ?? saved ?? DEFAULT_CONTENT;
			this._editor = new NumrEditor({
				parent: this.shadowRoot.querySelector(".editor"),
				session,
				content: initialContent,
				readOnly: this.readonly,
				ariaLabel: "numr calculator document",
				onChange: (evaluation) => this._handleEvaluation(evaluation),
				onError: (error) =>
					console.error("numr-calculator: Evaluation error", error),
			});

			this._ready = true;
			this.dispatchEvent(
				new CustomEvent("numr-ready", { bubbles: true, composed: true }),
			);
			if (!this.norates) this._initializeRates();
		} catch (error) {
			if (generation !== this._generation) return;
			console.error("numr-calculator: Failed to initialize", error);
			this._renderError(error);
		}
	}

	_initializeRates() {
		return this._loadRates("initialize");
	}

	_fetchRates() {
		return this._loadRates("refresh");
	}

	async _loadRates(operation) {
		const ratesService = this._ratesService;
		if (!ratesService || this._rateStatus === "loading") return;
		this._setRateStatus("loading");
		try {
			await ratesService[operation]();
			if (ratesService !== this._ratesService) return;
			this._setRateStatus("success");
			this._editor?.evaluateNow();
		} catch (error) {
			if (ratesService !== this._ratesService) return;
			console.warn(`numr-calculator: Failed to ${operation} rates`, error);
			this._setRateStatus("error");
		}
	}

	_handleEvaluation({ content, results, totals }) {
		if (this.autosave) {
			if (this._saveTimer) clearTimeout(this._saveTimer);
			this._saveTimer = setTimeout(() => {
				localStorage.setItem(this.storageKey, content);
				this._saveTimer = null;
			}, 300);
		}

		renderTokenTotals(
			this.shadowRoot.querySelector("footer"),
			this._session,
			totals,
		);
		this.dispatchEvent(
			new CustomEvent("numr-change", {
				bubbles: true,
				composed: true,
				detail: { content, results, totals },
			}),
		);
	}

	_setRateStatus(status) {
		this._rateStatus = status;
		const button = this.shadowRoot?.querySelector("button");
		if (button) button.className = status;
	}

	_renderLoading() {
		this.shadowRoot.innerHTML = `<style>${COMPONENT_STYLES}</style><div class="container" part="container"><div class="loading-view">Loading…</div></div>`;
	}

	_renderError(error) {
		const message = error instanceof Error ? error.message : String(error);
		const view = this.shadowRoot?.querySelector(".loading-view");
		if (view) view.textContent = `Failed to load calculator engine: ${message}`;
	}

	_renderReady() {
		this.shadowRoot.innerHTML = `
			<style>${COMPONENT_STYLES}</style>
			<div class="container${this.minimal ? " minimal" : ""}" part="container">
				<header part="header">
					<span class="logo">numr</span>
					<button class="${this._rateStatus}" title="Refresh exchange rates" aria-label="Refresh exchange rates">
						<svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
							<path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
							<path d="M21 3v5h-5" />
						</svg>
					</button>
				</header>
				<div class="editor" part="editor"></div>
				<footer part="footer"></footer>
			</div>`;
		this.shadowRoot.querySelector("button").addEventListener("click", () =>
			this.refreshRates(),
		);
	}

	_disposeRuntime() {
		if (this._saveTimer) {
			clearTimeout(this._saveTimer);
			if (this.autosave && this._editor) {
				localStorage.setItem(this.storageKey, this._editor.getContent());
			}
		}
		this._saveTimer = null;
		this._editor?.destroy();
		this._ratesService?.dispose();
		this._session?.dispose();
		this._editor = null;
		this._ratesService = null;
		this._session = null;
		this._ready = false;
		this._rateStatus = "idle";
	}

	getContent() {
		return this._editor?.getContent() || "";
	}

	setContent(content) {
		this._editor?.setContent(content);
	}

	clear() {
		this._session?.clear();
		this._editor?.setContent("");
	}

	refreshRates() {
		this._fetchRates();
	}

	focus() {
		this._editor?.focus();
	}
}

Object.defineProperties(NumrCalculator.prototype, {
	minimal: booleanProperty("minimal"),
	readonly: booleanProperty("readonly"),
	norates: booleanProperty("norates"),
	autosave: booleanProperty("autosave"),
});

if (!customElements.get("numr-calculator")) {
	customElements.define("numr-calculator", NumrCalculator);
}
