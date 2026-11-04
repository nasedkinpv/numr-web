/**
 * numr web - Calculator Application
 *
 * Architecture:
 * - WASM engine (numr-core) handles evaluation
 * - WASM tokenizer (numr-editor) handles syntax highlighting
 * - CodeMirror for the text buffer, native editing, and virtualized rendering
 * - Vanilla JS for the application shell and platform adapters
 *
 * No frameworks - just simple, readable code.
 */

import { NumrEditor } from "../shared/numr-editor.js";
import { manageViewport } from "./viewport.js";
import { NumrSession } from "../shared/numr-session.js";
import { RatesService } from "../shared/rates-service.js";
import {
	decodeContentFromHash,
	encodeContentForHash,
	parseShareHash,
} from "../shared/share-codec.js";
import { safeStorage, STORAGE_KEYS } from "../shared/storage.js";
import { renderTokenTotals } from "../shared/token-view.js";
import { loadDecimalPlaces, parseDecimalPlaces, saveDecimalPlaces } from "../shared/decimal-places.js";

// ============================================================================
// Theme (applied before anything renders)
// ============================================================================

const THEMES = ["system", "dark", "light"];

function applyTheme(theme) {
	if (theme === "system") delete document.documentElement.dataset.theme;
	else document.documentElement.dataset.theme = theme;
	const meta = document.querySelector('meta[name="theme-color"]');
	if (meta) {
		const dark =
			theme === "dark" ||
			(theme === "system" && !matchMedia("(prefers-color-scheme: light)").matches);
		meta.content = dark ? "#1a1c1e" : "#fafafa";
	}
}

function loadTheme() {
	const stored = safeStorage.getItem(STORAGE_KEYS.theme);
	return THEMES.includes(stored) ? stored : "system";
}

applyTheme(loadTheme());
matchMedia("(prefers-color-scheme: light)").addEventListener("change", () => {
	applyTheme(loadTheme());
});

// ============================================================================
// Constants
// ============================================================================

const WASM_ASSET_VERSION = __NUMR_ASSET_VERSION__;
const SHARE_DEFAULT_TITLE = "Share document link";
const SHARE_NATIVE_TITLE = "numr document";
const SHARE_NATIVE_TEXT = "Shared from numr";
const SHARE_URL_SOFT_LIMIT = 8000;
const SHARE_URL_HARD_LIMIT = 64000;
const SHARE_RESET_DELAY_MS = 3000;

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

# Statistics and angles
median(10, 30, 20)
clamp(120, 0, 100)
sin(90°)
90° to rad

# Currency (live rates)
1000 USD in EUR
0.1 BTC in USD
`;

// ============================================================================
// State
// ============================================================================

let session = null;
let ratesService = null;
let editor = null;
let documentSaveTimer = null;
let sharedDocumentActive = false;

// DOM element references (populated in init)
const $ = {
	editorHost: null,
	totals: null,
	btnRates: null,
	lineWrapping: null,
	lineNumbers: null,
	decimalPlaces: null,
	themeInputs: [],
	btnShare: null,
	btnNew: null,
	btnSave: null,
	btnLoad: null,
	fileInput: null,
};

// Rate fetch status
let rateStatus = "idle"; // 'idle' | 'loading' | 'success' | 'error'
let shareStatusTimer = null;

// ============================================================================
// Initialization
// ============================================================================

/**
 * Initialize local WASM modules. Rates load independently after first paint.
 */
async function initWasm() {
	session = await NumrSession.create({
		version: WASM_ASSET_VERSION,
	});
	ratesService = new RatesService(session, { store: window.numrRatesStore });
	initializeRates();
}

async function initializeRates() {
	const service = ratesService;
	updateRateStatus("loading");
	try {
		const result = await service.initialize();
		if (service !== ratesService) return;
		updateRateStatus("success", result.timestamp);
		editor?.evaluateNow();
	} catch (error) {
		if (service !== ratesService) return;
		console.warn("Failed to initialize exchange rates:", error);
		updateRateStatus("error");
	}
}

/**
 * Fetch exchange rates from APIs and apply to engine
 */
async function fetchRates(source = "auto") {
	if (!ratesService || rateStatus === "loading") return;
	updateRateStatus("loading");

	try {
		const result = await ratesService.refresh();
		updateRateStatus("success", result.timestamp);
		if (source === "manual") {
			trackEvent("Rates Refreshed");
		}
		editor?.evaluateNow();
	} catch (e) {
		console.warn("Failed to fetch rates:", e);
		updateRateStatus("error");
		if (source === "manual") {
			trackEvent("Rates Refresh Failed");
		}
	}
}

/**
 * Main initialization - called on page load
 */
async function init() {
	// The shared desktop entrypoint and embedded component do not own the page.
	if (document.querySelector("[data-web-viewport]")) {
		manageViewport(window, document.documentElement.style, () => editor?.revealCaretInScroller());
	}
	// Cache DOM references
	$.editorHost = document.getElementById("editor");
	$.totals = document.getElementById("totals");
	$.btnRates = document.getElementById("btn-rates");
	$.lineWrapping = document.getElementById("setting-wrap");
	$.lineNumbers = document.getElementById("setting-line-numbers");
	$.decimalPlaces = document.getElementById("decimal-places");
	$.themeInputs = Array.from(document.querySelectorAll('input[name="theme"]'));
	for (const input of $.themeInputs) input.checked = input.value === loadTheme();
	$.btnShare = document.getElementById("btn-share");
	$.btnNew = document.getElementById("btn-new");
	$.btnSave = document.getElementById("btn-save");
	$.btnLoad = document.getElementById("btn-load");
	$.fileInput = document.getElementById("file-input");
	updateShareStatus("idle");

	// Initialize WASM; exchange rates continue loading in the background.
	try {
		await initWasm();
	} catch (e) {
		console.error("Failed to initialize WASM:", e);
		const detail = e instanceof Error ? e.message : String(e);
		$.editorHost.textContent = `# Error: Failed to load calculator engine.\n# ${detail}`;
		return;
	}

	// Load shared content first, then localStorage/example fallback
	const initialDocument = await getInitialDocument();
	sharedDocumentActive = initialDocument.shared;
	const storedLineWrapping = safeStorage.getItem(STORAGE_KEYS.lineWrapping);
	const lineWrapping =
		storedLineWrapping === null || storedLineWrapping === "true";
	const storedLineNumbers = safeStorage.getItem(STORAGE_KEYS.lineNumbers);
	const showLineNumbers =
		storedLineNumbers === null || storedLineNumbers === "true";
	const decimalPlaces = loadDecimalPlaces();
	session.setDecimalPlaces(decimalPlaces);
	if ($.decimalPlaces) {
		$.decimalPlaces.value = decimalPlaces === undefined ? "" : String(decimalPlaces);
	}
	editor = new NumrEditor({
		parent: $.editorHost,
		session,
		content: initialDocument.content,
		lineWrapping,
		showLineNumbers,
		onDocumentChange: handleDocumentChange,
		onChange: handleEvaluation,
	});
	updateLineWrappingControl();
	updateLineNumbersControl();
	// Touch devices should not open the keyboard before an explicit tap.
	if (!matchMedia("(any-pointer: coarse)").matches) editor.focus();

	// Setup button event listeners
	setupEventListeners();
}

// ============================================================================
// Event Handling
// ============================================================================

function setupEventListeners() {
	$.decimalPlaces?.addEventListener("input", () => {
		try {
			const value = parseDecimalPlaces($.decimalPlaces.value);
			session.setDecimalPlaces(value);
			saveDecimalPlaces(value);
			editor.evaluateNow();
		} catch (error) {
			console.warn("Invalid decimal places:", error);
		}
	});
	for (const input of $.themeInputs) {
		input.addEventListener("change", () => {
			if (!input.checked) return;
			if (input.value === "system") safeStorage.removeItem(STORAGE_KEYS.theme);
			else safeStorage.setItem(STORAGE_KEYS.theme, input.value);
			applyTheme(input.value);
		});
	}
	$.lineWrapping?.addEventListener("change", () => setLineWrapping($.lineWrapping.checked));
	$.lineNumbers?.addEventListener("change", () => setLineNumbers($.lineNumbers.checked));
	$.btnRates.addEventListener("click", () => {
		if (rateStatus !== "loading") fetchRates("manual");
	});
	$.btnShare?.addEventListener("click", shareDocument);
	$.btnNew.addEventListener("click", newDocument);
	$.btnSave.addEventListener("click", saveFile);
	$.btnLoad?.addEventListener("click", () => $.fileInput?.click());
	$.fileInput?.addEventListener("change", loadFile);
}

// ============================================================================
// Core Logic
// ============================================================================

function handleDocumentChange(content) {
	notifyDocument("change", content);
	if (sharedDocumentActive) {
		window.history.replaceState(
			null,
			"",
			`${window.location.pathname}${window.location.search}`,
		);
		sharedDocumentActive = false;
	}
	if (documentSaveTimer) clearTimeout(documentSaveTimer);
	documentSaveTimer = setTimeout(() => {
		safeStorage.setItem(STORAGE_KEYS.document, content);
		documentSaveTimer = null;
	}, 250);
}

function handleEvaluation({ totals }) {
	renderTokenTotals($.totals, session, totals);
}

function toggleLineWrapping() {
	if (editor) setLineWrapping(!editor.lineWrapping);
}

function setLineWrapping(enabled) {
	if (!editor) return;
	editor.setLineWrapping(enabled);
	safeStorage.setItem(
		STORAGE_KEYS.lineWrapping,
		String(editor.lineWrapping),
	);
	updateLineWrappingControl();
}

function updateLineWrappingControl() {
	if ($.lineWrapping && editor) $.lineWrapping.checked = editor.lineWrapping;
}

function toggleLineNumbers() {
	if (editor) setLineNumbers(!editor.showLineNumbers);
}

function setLineNumbers(enabled) {
	if (!editor) return;
	editor.setLineNumbers(enabled);
	safeStorage.setItem(
		STORAGE_KEYS.lineNumbers,
		String(editor.showLineNumbers),
	);
	updateLineNumbersControl();
}

function updateLineNumbersControl() {
	if ($.lineNumbers && editor) $.lineNumbers.checked = editor.showLineNumbers;
}

// ============================================================================
// File Operations
// ============================================================================

function newDocument() {
	const content = editor.getContent();
	const unsaved =
		typeof window.numrDocumentIsDirty === "function"
			? window.numrDocumentIsDirty()
			: Boolean(content);
	if (unsaved && !confirm("Create new document? Unsaved changes will be lost.")) {
		return;
	}
	if (content.trim()) {
		trackEvent("New Document Created");
	}
	editor.setContent("");
	editor.focus();
	notifyDocument("new", "");
}

// Lets a host shell (numr-desktop) track the open file and its unsaved state.
function notifyDocument(kind, content) {
	window.dispatchEvent(
		new CustomEvent("numr-document", { detail: { kind, content } }),
	);
}

function saveFile() {
	const content = editor.getContent();
	if (typeof window.numrSaveDocument === "function") {
		window.numrSaveDocument(content);
		trackEvent("File Downloaded");
		return;
	}
	downloadFile(content);
}

function saveFileAs() {
	const content = editor.getContent();
	if (typeof window.numrSaveDocumentAs === "function") {
		window.numrSaveDocumentAs(content);
		return;
	}
	downloadFile(content);
}

function downloadFile(content) {
	const blob = new Blob([content], { type: "text/plain" });
	const url = URL.createObjectURL(blob);

	const a = document.createElement("a");
	a.href = url;
	a.download = "calculations.numr";
	a.click();

	URL.revokeObjectURL(url);
	trackEvent("File Downloaded");
}

function openDocument(content) {
	if (!editor) return false;
	editor.setContent(content);
	editor.focus();
	trackEvent("File Imported");
	return true;
}

function loadFile(event) {
	const file = event.target.files[0];
	if (!file) return;

	const reader = new FileReader();
	reader.onload = (e) => {
		const loadedContent =
			typeof e.target?.result === "string" ? e.target.result : "";
		openDocument(loadedContent);
	};
	reader.readAsText(file);

	// Reset input so same file can be loaded again
	event.target.value = "";
}

window.numrOpenDocument = openDocument;

async function shareDocument() {
	if (!editor) return;

	updateShareStatus("loading", "Preparing link...");

	try {
		const shareUrl = getShareUrl();
		if (!shareUrl) return;

		const nativeShareResult = await tryNativeShare(shareUrl);
		if (nativeShareResult === "success") {
			trackShareCreated("native");
			updateShareStatus("success", "Shared");
			return;
		}
		if (nativeShareResult === "aborted") {
			updateShareStatus("idle");
			return;
		}

		const copied = await copyText(shareUrl);
		if (copied) {
			trackShareCreated("clipboard");
			updateShareStatus(
				"success",
				getShareStatusMessage(shareUrl.length, true),
			);
			return;
		}

		const manualCopy = window.prompt("Copy this share URL:", shareUrl);
		if (manualCopy === null) {
			updateShareStatus("idle");
			return;
		}

		trackShareCreated("manual");
		updateShareStatus("success", getShareStatusMessage(shareUrl.length, false));
	} catch (error) {
		console.warn("Failed to create share link:", error);
		updateShareStatus("error", "Failed to create share link");
	}
}

function publishDocument() {
	if (!editor) return;
	const shareUrl = getShareUrl();
	if (!shareUrl) return;

	window.dispatchEvent(
		new CustomEvent("numr-publish", { detail: { url: shareUrl } }),
	);
	trackShareCreated("publish");
	updateShareStatus("success", "Opened in browser");
}

function getShareUrl() {
	const content = editor.getContent();
	const hashPayload = encodeContentForHash(content);
	const shareUrl = buildShareUrl(hashPayload);

	if (shareUrl.length <= SHARE_URL_HARD_LIMIT) {
		return shareUrl;
	}

	updateShareStatus("error", "Link is too large. Use Download");
	trackEvent("Share Link Too Large");
	return null;
}

function buildShareUrl(hashPayload) {
	if ("__TAURI__" in window) {
		return `https://numr.cc/#${hashPayload}`;
	}
	return `${window.location.origin}${window.location.pathname}${window.location.search}#${hashPayload}`;
}

function getShareStatusMessage(urlLength, copied) {
	if (urlLength > SHARE_URL_SOFT_LIMIT) {
		return copied
			? `Large link copied (${urlLength} chars)`
			: `Large link ready (${urlLength} chars)`;
	}
	return copied ? "Link copied" : "Link ready";
}

async function tryNativeShare(url) {
	if (typeof window.numrCopyText === "function") return "unsupported";
	if (typeof navigator.share !== "function") return "unsupported";

	try {
		await navigator.share({
			title: SHARE_NATIVE_TITLE,
			text: SHARE_NATIVE_TEXT,
			url,
		});
		return "success";
	} catch (error) {
		if (error?.name === "AbortError") {
			return "aborted";
		}
		return "failed";
	}
}

async function getInitialDocument() {
	const sharedContent = await readContentFromHash();
	if (sharedContent !== null) return { content: sharedContent, shared: true };
	const saved = safeStorage.getItem(STORAGE_KEYS.document);
	return { content: saved ?? EXAMPLE_CONTENT, shared: false };
}

async function readContentFromHash() {
	const parsed = parseShareHash(window.location.hash);
	if (!parsed) return null;

	try {
		const content = await decodeContentFromHash(parsed.mode, parsed.payload);
		trackEvent("Shared Link Opened", { format: parsed.mode });
		return content;
	} catch (error) {
		console.warn("Failed to decode shared link:", error);
		updateShareStatus("error", "Invalid share link");
		trackEvent("Shared Link Invalid", { format: parsed.mode });
		window.history.replaceState(
			null,
			"",
			`${window.location.pathname}${window.location.search}`,
		);
		return null;
	}
}

async function copyText(text) {
	if (typeof window.numrCopyText === "function") {
		try {
			return await window.numrCopyText(text);
		} catch {
			return false;
		}
	}

	if (navigator.clipboard?.writeText && window.isSecureContext) {
		try {
			await navigator.clipboard.writeText(text);
			return true;
		} catch {
			return false;
		}
	}
	return false;
}

function updateShareStatus(status, title = SHARE_DEFAULT_TITLE) {
	if (!$.btnShare) return;

	$.btnShare.classList.remove("loading", "success", "error");

	if (shareStatusTimer) {
		clearTimeout(shareStatusTimer);
		shareStatusTimer = null;
	}

	if (status === "loading") {
		$.btnShare.classList.add("loading");
		$.btnShare.title = title;
		return;
	}

	if (status === "success" || status === "error") {
		$.btnShare.classList.add(status);
		$.btnShare.title = title;
		shareStatusTimer = setTimeout(() => {
			$.btnShare.classList.remove("success", "error");
			$.btnShare.title = SHARE_DEFAULT_TITLE;
			shareStatusTimer = null;
		}, SHARE_RESET_DELAY_MS);
		return;
	}

	$.btnShare.title = title;
}

function trackShareCreated(method) {
	trackEvent("Share Link Created", { method });
}

function trackEvent(name, data = undefined) {
	const track = window.umami?.track;
	if (typeof track !== "function") return;

	try {
		track(name, data);
	} catch {
		// Analytics is best-effort and must never affect calculator behavior.
	}
}

/**
 * Format timestamp as relative time (e.g., "5m", "1h")
 */
function formatTime(timestamp) {
	const mins = Math.floor((Date.now() - timestamp) / 60000);
	if (mins < 1) return "now";
	if (mins < 60) return `${mins}m`;
	return `${Math.floor(mins / 60)}h`;
}

/**
 * Update rate button visual status
 */
function updateRateStatus(status, timestamp = null) {
	rateStatus = status;
	if (!$.btnRates) return;

	$.btnRates.classList.remove("loading", "success", "error");

	switch (status) {
		case "loading":
			$.btnRates.classList.add("loading");
			$.btnRates.title = "Loading rates...";
			break;
		case "success":
			$.btnRates.classList.add("success");
			$.btnRates.title = `Rates updated: ${timestamp ? formatTime(parseInt(timestamp)) : "now"}`;
			break;
		case "error":
			$.btnRates.classList.add("error");
			$.btnRates.title = "Failed to load rates";
			break;
		default:
			$.btnRates.title = "Refresh exchange rates";
	}
}

window.numrActions = {
	newDocument,
	saveDocument: saveFile,
	saveDocumentAs: saveFileAs,
	publishDocument,
	refreshRates: () => fetchRates("manual"),
	toggleLineWrapping,
};

window.addEventListener("beforeunload", () => {
	if (documentSaveTimer && editor) {
		safeStorage.setItem(STORAGE_KEYS.document, editor.getContent());
	}
});

// ============================================================================
// Start
// ============================================================================

window.numrReady = init();
