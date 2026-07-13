import Electrobun, {
	ApplicationMenu,
	BrowserView,
	BrowserWindow,
	Tray,
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
			hideWindow: () => {
				setWindowVisible(false);
			},
		},
	},
});

ApplicationMenu.setApplicationMenu([
	{
		submenu: [{ role: "quit" }],
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
			{ label: "Hide numr", action: "hide-window", accelerator: "w" },
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
		],
	},
]);

const isMacOS = process.platform === "darwin";

if (isMacOS) {
	Utils.setDockIconVisible(false);
}

const win = new BrowserWindow({
	title: "numr",
	url: "views://mainview/index.html",
	frame: { width: 1040, height: 720, x: 120, y: 80 },
	titleBarStyle: "hidden",
	transparent: true,
	rpc,
});

let windowVisible = true;

// TODO(desktop): Replace the temporary SF Symbols raster with a shared SVG tray icon.
const tray = new Tray({
	image: isMacOS
		? "views://assets/numr-tray-sf-template.png"
		: "views://mainview/favicon.png",
	template: isMacOS,
	width: 18,
	height: 18,
});

function updateTrayMenu() {
	tray.setMenu([
		{
			label: windowVisible ? "Hide numr" : "Show numr",
			action: "toggle-window",
		},
		{ type: "separator" },
		{ label: "Quit numr", action: "quit-app" },
	]);
}

function setWindowVisible(visible: boolean) {
	if (visible === windowVisible) {
		if (visible) win.activate();
		return;
	}

	if (visible) {
		win.show();
	} else {
		win.hide();
	}

	windowVisible = visible;
	updateTrayMenu();
}

tray.on("tray-clicked", (event) => {
	const { action } = event.data as { action: string };

	switch (action) {
		case "toggle-window":
			setWindowVisible(!windowVisible);
			break;
		case "quit-app":
			Utils.quit();
			break;
		default:
			break;
	}
});

updateTrayMenu();

async function openPath(path: string) {
	const content = await Bun.file(path).text();
	setWindowVisible(true);
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
		case "hide-window":
			setWindowVisible(false);
			break;
		default:
			break;
	}
});
