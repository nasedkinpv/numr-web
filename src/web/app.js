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
	btnWrap: null,
	btnLineNumbers: null,
	decimalPlaces: null,
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
	ratesService = new RatesService(session);
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
	// Cache DOM references
	$.editorHost = document.getElementById("editor");
	$.totals = document.getElementById("totals");
	$.btnRates = document.getElementById("btn-rates");
	$.btnWrap = document.getElementById("btn-wrap");
	$.btnLineNumbers = document.getElementById("btn-line-numbers");
	$.decimalPlaces = document.getElementById("decimal-places");
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
		for (let value = 0; value <= 28; value++) {
			$.decimalPlaces.add(new Option(String(value), String(value)));
		}
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
	// Focus editor
	editor.focus();

	// Setup button event listeners
	setupEventListeners();
}

// ============================================================================
// Event Handling
// ============================================================================

function setupEventListeners() {
	$.decimalPlaces?.addEventListener("change", () => {
		try {
			const value = parseDecimalPlaces($.decimalPlaces.value);
			session.setDecimalPlaces(value);
			saveDecimalPlaces(value);
			editor.evaluateNow();
		} catch (error) {
			console.warn("Invalid decimal places:", error);
		}
	});
	$.btnWrap?.addEventListener("click", toggleLineWrapping);
	$.btnLineNumbers?.addEventListener("click", toggleLineNumbers);
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
	if (!editor) return;
	editor.setLineWrapping(!editor.lineWrapping);
	safeStorage.setItem(
		STORAGE_KEYS.lineWrapping,
		String(editor.lineWrapping),
	);
	updateLineWrappingControl();
}

function updateLineWrappingControl() {
	if (!$.btnWrap || !editor) return;
	const enabled = editor.lineWrapping;
	const label = enabled ? "Disable line wrapping" : "Wrap long lines";
	$.btnWrap.classList.toggle("active", enabled);
	$.btnWrap.setAttribute("aria-pressed", String(enabled));
	$.btnWrap.setAttribute("aria-label", label);
	$.btnWrap.title = label;
}

function toggleLineNumbers() {
	if (!editor) return;
	editor.setLineNumbers(!editor.showLineNumbers);
	safeStorage.setItem(
		STORAGE_KEYS.lineNumbers,
		String(editor.showLineNumbers),
	);
	updateLineNumbersControl();
}

function updateLineNumbersControl() {
	if (!$.btnLineNumbers || !editor) return;
	const enabled = editor.showLineNumbers;
	const label = enabled ? "Hide line numbers" : "Show line numbers";
	$.btnLineNumbers.classList.toggle("active", enabled);
	$.btnLineNumbers.setAttribute("aria-pressed", String(enabled));
	$.btnLineNumbers.setAttribute("aria-label", label);
	$.btnLineNumbers.title = label;
}

// ============================================================================
// File Operations
// ============================================================================

function newDocument() {
	const content = editor.getContent();
	if (
		content &&
		!confirm("Create new document? Unsaved changes will be lost.")
	) {
		return;
	}
	if (content.trim()) {
		trackEvent("New Document Created");
	}
	editor.setContent("");
	editor.focus();
}

function saveFile() {
	const content = editor.getContent();
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
	if (location.protocol === "views:") {
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

init();
