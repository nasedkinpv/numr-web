// Bridge between the shared web app and the Tauri shell (numr-desktop).
// Loaded only by desktop/index.html; relies on `withGlobalTauri`.
const { core, event, clipboardManager, opener } = window.__TAURI__;
const tauriWindow = window.__TAURI__.window.getCurrentWindow();

// Exchange-rate cache shared with the numr TUI/CLI (~/.config/numr/rates.json).
// Set synchronously: app.js reads it when it builds its RatesService.
window.numrRatesStore = {
	load: () => core.invoke("shared_rates"),
	save: (rates, timestamp) => core.invoke("store_shared_rates", { rates, timestamp }),
};

// ---------------------------------------------------------------------------
// Open file and unsaved state
// ---------------------------------------------------------------------------

const documentState = { name: null, savedContent: "", dirty: false };
const nameLabel = document.getElementById("document-name");

function renderDocumentState() {
	const { name, dirty } = documentState;
	const label = `${name ?? "Untitled"}${dirty ? " •" : ""}`;
	if (nameLabel) {
		nameLabel.textContent = label;
		nameLabel.classList.toggle("untitled", name === null);
		nameLabel.classList.toggle("dirty", dirty);
	}
	tauriWindow.setTitle(`${label} — numr`).catch(() => {});
}

function markSaved(name, content) {
	documentState.name = name;
	documentState.savedContent = content;
	documentState.dirty = false;
	renderDocumentState();
}

function openFromShell({ content, name }) {
	if (!window.numrOpenDocument?.(content)) return;
	markSaved(name ?? null, content);
}

window.addEventListener("numr-document", ({ detail }) => {
	if (detail.kind === "new") {
		markSaved(null, "");
		core.invoke("close_document");
	} else if (detail.kind === "change") {
		documentState.dirty = detail.content !== documentState.savedContent;
		renderDocumentState();
	}
});

window.numrDocumentIsDirty = () => documentState.dirty;

async function save(command, content) {
	const name = await core.invoke(command, { content });
	if (name) markSaved(name, content);
	return Boolean(name);
}
window.numrSaveDocument = (content) => save("save_document", content);
window.numrSaveDocumentAs = (content) => save("save_document_as", content);

// ---------------------------------------------------------------------------
// Actions, clipboard, links, shortcuts
// ---------------------------------------------------------------------------

const actions = {
	"new-document": () => window.numrActions?.newDocument?.(),
	"open-document": () => core.invoke("open_document_dialog"),
	"save-document": () => window.numrActions?.saveDocument?.(),
	"save-document-as": () => window.numrActions?.saveDocumentAs?.(),
	"publish-document": () => window.numrActions?.publishDocument?.(),
	"refresh-rates": () => window.numrActions?.refreshRates?.(),
	"toggle-line-wrapping": () => window.numrActions?.toggleLineWrapping?.(),
	"hide-window": () => core.invoke("hide_window"),
};

window.numrCopyText = (text) => clipboardManager.writeText(text).then(() => true);

window.addEventListener("numr-publish", (e) => opener.openUrl(e.detail.url));
document.getElementById("btn-hide")?.addEventListener("click", actions["hide-window"]);

// macOS gets these from the native menu; elsewhere the webview owns them.
if (!navigator.platform.startsWith("Mac")) {
	const shortcuts = {
		n: "new-document",
		o: "open-document",
		s: "save-document",
		S: "save-document-as",
		w: "hide-window",
		r: "refresh-rates",
	};
	window.addEventListener("keydown", (e) => {
		const key = e.key.toLowerCase();
		let action = null;
		if (e.altKey && !e.ctrlKey && key === "z") action = "toggle-line-wrapping";
		else if (e.ctrlKey && !e.altKey) action = shortcuts[e.shiftKey ? key.toUpperCase() : key];
		if (!action) return;
		e.preventDefault();
		actions[action]();
	});
}

await event.listen("menu-action", ({ payload }) => actions[payload]?.());
await event.listen("open-document", ({ payload }) => openFromShell(payload));

await window.numrReady;
renderDocumentState();
for (const payload of await core.invoke("pending_documents")) {
	openFromShell(payload);
}
