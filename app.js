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

import { CodeJar } from "https://esm.sh/codejar@4.3.0";
import { NumrSession } from "./src/shared/numr-session.js";
import { RatesService } from "./src/shared/rates-service.js";
import {
	decodeContentFromHash,
	encodeContentForHash,
	parseShareHash,
} from "./src/shared/share-codec.js";
import {
	escapeHtml,
	renderTokens as renderTokenHtml,
	replaceHtml,
} from "./src/shared/token-renderer.js";

// ============================================================================
// Constants
// ============================================================================

const STORAGE_KEY = "numr-document";
const WASM_ASSET_VERSION = "6f90bf54d1";
const SHARE_DEFAULT_TITLE = "Share document link";
const SHARE_NATIVE_TITLE = "numr document";
const SHARE_NATIVE_TEXT = "Shared from numr";
const SHARE_URL_SOFT_LIMIT = 8000;
const SHARE_URL_HARD_LIMIT = 64000;
const SHARE_RESET_DELAY_MS = 3000;
const textEncoder = new TextEncoder();

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
let jar = null; // CodeJar editor instance

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
let rateStatus = "idle"; // 'idle' | 'loading' | 'success' | 'error'
let shareStatusTimer = null;
const analyticsState = {
	initialSource: "example",
	editorEngagedTracked: false,
};

// ============================================================================
// Initialization
// ============================================================================

/**
 * Initialize WASM modules and fetch exchange rates
 */
async function initWasm() {
	session = await NumrSession.create({
		version: WASM_ASSET_VERSION,
	});
	ratesService = new RatesService(session);
	updateRateStatus("loading");
	try {
		const result = await ratesService.initialize();
		updateRateStatus("success", result.timestamp);
	} catch (error) {
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
		evaluate();
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
	$.editor = document.getElementById("editor");
	$.lineNumbers = document.getElementById("line-numbers");
	$.results = document.getElementById("results");
	$.totals = document.getElementById("totals");
	$.btnRates = document.getElementById("btn-rates");
	$.btnShare = document.getElementById("btn-share");
	$.btnNew = document.getElementById("btn-new");
	$.btnSave = document.getElementById("btn-save");
	$.btnLoad = document.getElementById("btn-load");
	$.fileInput = document.getElementById("file-input");
	updateShareStatus("idle");

	// Initialize WASM (includes rate fetching)
	try {
		await initWasm();
	} catch (e) {
		console.error("Failed to initialize WASM:", e);
		const detail = e instanceof Error ? e.message : String(e);
		$.editor.textContent = `# Error: Failed to load calculator engine.\n# ${detail}`;
		return;
	}

	// Initialize CodeJar with syntax highlighting
	jar = CodeJar($.editor, highlight, {
		tab: "  ",
		spellcheck: false,
		catchTab: false, // Allow tab to move focus (more natural for calculator)
		preserveIdent: false, // Calculator doesn't need indentation
		addClosing: true, // Auto-close parentheses
		autoclose: {
			open: "(",
			close: ")",
		},
	});

	// Load shared content first, then localStorage/example fallback
	const initialContent = await getInitialContent();
	jar.updateCode(initialContent);

	// Listen for changes
	jar.onUpdate(() => evaluate());
	$.editor.addEventListener("input", trackEditorEngagement, { passive: true });

	// Initial render
	evaluate();

	// Focus editor
	$.editor.focus();

	// Setup button event listeners
	setupEventListeners();

}

// ============================================================================
// Syntax Highlighting (for CodeJar)
// ============================================================================

/**
 * Highlight function for CodeJar - applies syntax highlighting via WASM tokenizer
 */
function highlight(editor) {
	const code = editor.textContent || "";

	if (!code || !session) {
		replaceHtml(editor, escapeHtml(code) || "\n");
		return;
	}

	// Get known variable names for enhanced highlighting
	const knownVars = getKnownVariables();

	const lines = code.split("\n");
	const html = lines
		.map((line, i) => {
			if (!line) return i < lines.length - 1 ? "\n" : "";
			return renderTokens(line, knownVars) + (i < lines.length - 1 ? "\n" : "");
		})
		.join("");

	replaceHtml(editor, html || "\n");
}

/**
 * Get set of known variable names from engine
 */
function getKnownVariables() {
	return session?.getVariableNames() || "";
}

// ============================================================================
// Event Handling
// ============================================================================

function setupEventListeners() {
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

/**
 * Evaluate document and update all UI elements
 */
function evaluate() {
	if (!session || !jar) return;

	const content = jar.toString();
	const lines = content.split("\n");

	// Save to localStorage
	localStorage.setItem(STORAGE_KEY, content);

	// Evaluate all lines via WASM engine
	let results = [];
	let totals = [];
	try {
		({ results, totals } = session.evaluateDocument(content));
	} catch (error) {
		console.error("Evaluation error:", error);
	}

	// Update UI
	renderLineNumbers(lines.length, results);
	renderResults(results);
	renderFooter(totals);
}

// ============================================================================
// Rendering
// ============================================================================

/**
 * Render line numbers in left gutter (with error bullets like VS Code)
 */
function renderLineNumbers(count, results) {
	let html = "";
	for (let i = 1; i <= count; i++) {
		const r = results[i - 1];
		if (r && r.is_error) {
			html += `<div class="line error" title="${escapeHtml(r.result)}"><span class="error-bullet"></span>${i}</div>`;
		} else {
			html += `<div class="line">${i}</div>`;
		}
	}
	replaceHtml($.lineNumbers, html);
}

/**
 * Render results in right gutter (with syntax highlighting)
 */
function renderResults(results) {
	replaceHtml(
		$.results,
		results
			.map((r) =>
				r.is_empty || r.is_error
					? '<div class="line"></div>'
					: `<div class="line">${renderTokens(r.result)}</div>`,
			)
			.join(""),
	);
}

/**
 * Render footer (totals with syntax highlighting)
 */
function renderFooter(totals) {
	replaceHtml(
		$.totals,
		totals.length > 0
			? `<span class="total-label">total:</span> ${totals.map((total) => renderTokens(total)).join("&nbsp;&nbsp;")}`
			: "",
	);
}

// ============================================================================
// File Operations
// ============================================================================

function newDocument() {
	const content = jar.toString();
	if (
		content &&
		!confirm("Create new document? Unsaved changes will be lost.")
	) {
		return;
	}
	if (content.trim()) {
		trackEvent("New Document Created", {
			previous_source: analyticsState.initialSource,
			...getDocumentMetrics(content),
		});
	}
	jar.updateCode("");
	session?.clear();
	analyticsState.initialSource = "new_document";
	evaluate();
	$.editor.focus();
}

function saveFile() {
	const content = jar.toString();
	const blob = new Blob([content], { type: "text/plain" });
	const url = URL.createObjectURL(blob);

	const a = document.createElement("a");
	a.href = url;
	a.download = "calculations.numr";
	a.click();

	URL.revokeObjectURL(url);
	trackEvent("File Downloaded", {
		source: analyticsState.initialSource,
		...getDocumentMetrics(content),
	});
}

function openDocument(
	content,
	source = "file_import",
	filename = "calculations.numr",
) {
	if (!jar) return false;
	jar.updateCode(content);
	analyticsState.initialSource = source;
	evaluate();
	$.editor.focus();
	trackEvent("File Imported", {
		file_extension: getFileExtension(filename),
		file_size_bucket: getByteBucket(textEncoder.encode(content).length),
		...getDocumentMetrics(content),
	});
	return true;
}

function loadFile(event) {
	const file = event.target.files[0];
	if (!file) return;

	const reader = new FileReader();
	reader.onload = (e) => {
		const loadedContent =
			typeof e.target?.result === "string" ? e.target.result : "";
		openDocument(loadedContent, "file_import", file.name);
	};
	reader.readAsText(file);

	// Reset input so same file can be loaded again
	event.target.value = "";
}

window.numrOpenDocument = openDocument;

async function shareDocument() {
	if (!jar) return;

	updateShareStatus("loading", "Preparing link...");

	try {
		const share = getShareLink();
		if (!share) return;
		const { content, hashPayload, shareUrl } = share;

		window.history.replaceState(null, "", `#${hashPayload}`);

		const nativeShareResult = await tryNativeShare(shareUrl);
		if (nativeShareResult === "success") {
			trackShareCreated("native", shareUrl, content);
			updateShareStatus("success", "Shared");
			return;
		}
		if (nativeShareResult === "aborted") {
			updateShareStatus("idle");
			return;
		}

		const copied = await copyText(shareUrl);
		if (copied) {
			trackShareCreated("clipboard", shareUrl, content);
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

		trackShareCreated("manual", shareUrl, content);
		updateShareStatus("success", getShareStatusMessage(shareUrl.length, false));
	} catch (error) {
		console.warn("Failed to create share link:", error);
		updateShareStatus("error", "Failed to create share link");
	}
}

function publishDocument() {
	if (!jar) return;
	const share = getShareLink();
	if (!share) return;

	window.dispatchEvent(
		new CustomEvent("numr-publish", { detail: { url: share.shareUrl } }),
	);
	trackShareCreated("publish", share.shareUrl, share.content);
	updateShareStatus("success", "Opened in browser");
}

function getShareLink() {
	const content = jar.toString();
	const hashPayload = encodeContentForHash(content);
	const shareUrl = buildShareUrl(hashPayload);

	if (shareUrl.length <= SHARE_URL_HARD_LIMIT) {
		return { content, hashPayload, shareUrl };
	}

	updateShareStatus("error", "Link is too large. Use Download");
	trackEvent("Share Link Too Large", {
		source: analyticsState.initialSource,
		link_size_bucket: getLinkSizeBucket(shareUrl.length),
		...getDocumentMetrics(content),
	});
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

async function getInitialContent() {
	const sharedContent = await readContentFromHash();
	if (sharedContent !== null) {
		analyticsState.initialSource = "share_link";
		return sharedContent;
	}
	const saved = localStorage.getItem(STORAGE_KEY);
	analyticsState.initialSource = saved ? "local_storage" : "example";
	return saved || EXAMPLE_CONTENT;
}

async function readContentFromHash() {
	const parsed = parseShareHash(window.location.hash);
	if (!parsed) return null;

	try {
		const content = await decodeContentFromHash(parsed.mode, parsed.payload);
		trackEvent("Shared Link Opened", {
			format: parsed.mode,
			...getDocumentMetrics(content),
		});
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
	if (navigator.clipboard?.writeText && window.isSecureContext) {
		try {
			await navigator.clipboard.writeText(text);
			return true;
		} catch {
			// Fall back to execCommand below.
		}
	}

	const textarea = document.createElement("textarea");
	textarea.value = text;
	textarea.setAttribute("readonly", "");
	textarea.style.position = "fixed";
	textarea.style.opacity = "0";
	textarea.style.pointerEvents = "none";
	document.body.appendChild(textarea);
	textarea.focus();
	textarea.select();

	let copied = false;
	try {
		copied = document.execCommand("copy");
	} catch {
		copied = false;
	} finally {
		document.body.removeChild(textarea);
	}

	return copied;
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

function trackEditorEngagement() {
	if (analyticsState.editorEngagedTracked) return;

	analyticsState.editorEngagedTracked = true;
	trackEvent("Editor Engaged", {
		source: analyticsState.initialSource,
		...getDocumentMetrics(jar?.toString() || ""),
	});
}

function trackShareCreated(method, shareUrl, content) {
	trackEvent("Share Link Created", {
		method,
		source: analyticsState.initialSource,
		link_size_bucket: getLinkSizeBucket(shareUrl.length),
		...getDocumentMetrics(content),
	});
}

function trackEvent(name, data = undefined) {
	const payload = sanitizeAnalyticsData(data);
	const track = window.umami?.track;
	if (typeof track !== "function") return;

	try {
		if (payload && Object.keys(payload).length > 0) {
			track(name, payload);
		} else {
			track(name);
		}
	} catch {
		// Analytics is best-effort and must never affect calculator behavior.
	}
}

function sanitizeAnalyticsData(data) {
	if (!data) return undefined;

	const entries = Object.entries(data).filter(
		([, value]) => value !== undefined && value !== null && value !== "",
	);

	return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function getDocumentMetrics(content) {
	const length = content.length;
	const lineCount = content ? content.split("\n").length : 0;

	return {
		content_bucket: getContentBucket(length),
		line_bucket: getLineBucket(lineCount),
	};
}

function getContentBucket(length) {
	if (length === 0) return "empty";
	if (length <= 80) return "1-80";
	if (length <= 300) return "81-300";
	if (length <= 1500) return "301-1500";
	return "1500+";
}

function getLineBucket(lineCount) {
	if (lineCount === 0) return "0";
	if (lineCount <= 1) return "1";
	if (lineCount <= 5) return "2-5";
	if (lineCount <= 20) return "6-20";
	if (lineCount <= 50) return "21-50";
	return "50+";
}

function getByteBucket(byteCount) {
	if (byteCount <= 1024) return "0-1kb";
	if (byteCount <= 10 * 1024) return "1-10kb";
	if (byteCount <= 64 * 1024) return "10-64kb";
	return "64kb+";
}

function getLinkSizeBucket(length) {
	if (length <= 1000) return "0-1k";
	if (length <= 4000) return "1k-4k";
	if (length <= 8000) return "4k-8k";
	return "8k+";
}

function getFileExtension(filename) {
	const parts = filename.toLowerCase().split(".");
	return parts.length > 1 ? parts.pop() : "unknown";
}

// ============================================================================
// Utilities
// ============================================================================

/**
 * Render tokens as syntax-highlighted HTML
 * Enhances tokenization by highlighting known variable references
 */
function renderTokens(text, knownVars = null) {
	return renderTokenHtml(session, text, knownVars || "", "token-");
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
};

// ============================================================================
// Start
// ============================================================================

init();
