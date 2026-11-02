// Bridge between the shared web app and the Tauri shell (numr-desktop).
// Loaded only by desktop/index.html; relies on `withGlobalTauri`.
const { core, event, clipboardManager, opener } = window.__TAURI__;

const actions = {
	"new-document": () => window.numrActions?.newDocument?.(),
	"open-document": () => core.invoke("open_document_dialog"),
	"save-document": () => window.numrActions?.saveDocument?.(),
	"publish-document": () => window.numrActions?.publishDocument?.(),
	"refresh-rates": () => window.numrActions?.refreshRates?.(),
	"toggle-line-wrapping": () => window.numrActions?.toggleLineWrapping?.(),
	"hide-window": () => core.invoke("hide_window"),
};

window.numrCopyText = (text) => clipboardManager.writeText(text).then(() => true);
window.numrSaveDocument = (content) => core.invoke("save_document", { content });

window.addEventListener("numr-publish", (e) => opener.openUrl(e.detail.url));
document.getElementById("btn-hide")?.addEventListener("click", actions["hide-window"]);

// macOS gets these from the native menu; elsewhere the webview owns them.
if (!navigator.platform.startsWith("Mac")) {
	const shortcuts = {
		n: "new-document",
		o: "open-document",
		s: "save-document",
		w: "hide-window",
		r: "refresh-rates",
	};
	window.addEventListener("keydown", (e) => {
		const key = e.key.toLowerCase();
		const action = e.altKey && !e.ctrlKey && key === "z"
			? "toggle-line-wrapping"
			: e.ctrlKey && !e.altKey && !e.shiftKey && shortcuts[key];
		if (!action) return;
		e.preventDefault();
		actions[action]();
	});
}

await event.listen("menu-action", ({ payload }) => actions[payload]?.());
await event.listen("open-document", ({ payload }) => window.numrOpenDocument?.(payload));

await window.numrReady;
for (const content of await core.invoke("pending_documents")) {
	window.numrOpenDocument?.(content);
}
