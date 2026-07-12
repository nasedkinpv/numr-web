import Electrobun, {
	ApplicationMenu,
	BrowserView,
	BrowserWindow,
	Utils,
} from "electrobun/bun";
import { fileURLToPath } from "node:url";

type OpenDocumentPayload = { content: string; path: string };

let webviewReady = false;
const pendingDocuments: OpenDocumentPayload[] = [];

function sendOpenDocument(payload: OpenDocumentPayload) {
	if (!webviewReady) {
		pendingDocuments.push(payload);
		return;
	}
	win.webview?.rpc.send.openDocument(payload);
}

function sendWebviewAction(action: string) {
	win.webview?.rpc.send.menuAction({ action });
}

const rpc = BrowserView.defineRPC({
	handlers: {
		requests: {},
		messages: {
			webviewReady: () => {
				webviewReady = true;
				let document = pendingDocuments.shift();
				while (document) {
					sendOpenDocument(document);
					document = pendingDocuments.shift();
				}
			},
			openExternal: ({ url }: { url: string }) => {
				Utils.openExternal(url);
			},
		},
	},
});

ApplicationMenu.setApplicationMenu([
	{
		submenu: [
			{ role: "hide" },
			{ role: "hideOthers" },
			{ role: "showAll" },
			{ type: "separator" },
			{ role: "quit" },
		],
	},
	{
		label: "File",
		submenu: [
			{ label: "New", action: "new-document", accelerator: "n" },
			{ label: "Open…", action: "open-document", accelerator: "o" },
			{ label: "Save", action: "save-document", accelerator: "s" },
			{ type: "separator" },
			{ label: "Publish", action: "publish-document" },
			{ type: "separator" },
			{ role: "close" },
		],
	},
	{
		label: "Edit",
		submenu: [
			{ role: "undo" },
			{ role: "redo" },
			{ type: "separator" },
			{ role: "cut" },
			{ role: "copy" },
			{ role: "paste" },
			{ role: "pasteAndMatchStyle" },
			{ role: "delete" },
			{ role: "selectAll" },
		],
	},
	{
		label: "View",
		submenu: [
			{ label: "Refresh Rates", action: "refresh-rates", accelerator: "r" },
			{ type: "separator" },
			{ role: "toggleFullScreen" },
		],
	},
	{
		label: "Window",
		submenu: [
			{ role: "minimize" },
			{ role: "zoom" },
			{ type: "separator" },
			{ role: "bringAllToFront" },
		],
	},
]);

const win = new BrowserWindow({
	title: "numr",
	url: "views://mainview/index.html",
	frame: { width: 1040, height: 720, x: 120, y: 80 },
	titleBarStyle: "hiddenInset",
	trafficLightOffset: { x: 12, y: 12 },
	rpc,
});

async function openPath(path: string) {
	const content = await Bun.file(path).text();
	sendOpenDocument({ content, path });
}

async function openFileUrl(fileUrl: string) {
	try {
		await openPath(fileURLToPath(fileUrl));
	} catch (error) {
		console.error("Failed to open file URL", error);
	}
}

async function openDocumentDialog() {
	const [path] = await Utils.openFileDialog({
		allowedFileTypes: "numr,txt",
		canChooseFiles: true,
		canChooseDirectory: false,
		allowsMultipleSelection: false,
	});
	if (path) await openPath(path);
}

Electrobun.events.on("open-url", (event) => {
	if (event.data.url.startsWith("file:")) {
		openFileUrl(event.data.url).catch(console.error);
	}
});

Electrobun.events.on("application-menu-clicked", (event) => {
	switch (event.data.action) {
		case "open-document":
			openDocumentDialog().catch(console.error);
			break;
		case "new-document":
		case "save-document":
		case "publish-document":
		case "refresh-rates":
			sendWebviewAction(event.data.action);
			break;
		default:
			break;
	}
});
