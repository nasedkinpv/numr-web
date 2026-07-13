import { Electroview } from "electrobun/view";

declare global {
	interface Window {
		numrActions?: Record<string, () => void>;
		numrCopyText?: (text: string) => Promise<boolean>;
		numrOpenDocument?: (content: string) => boolean;
	}

	interface WindowEventMap {
		"numr-publish": CustomEvent<{ url: string }>;
	}
}

const electroview = new Electroview({
	rpc: Electroview.defineRPC({
		handlers: {
			requests: {},
			messages: {
				openDocument: ({ content }: { content: string }) => {
					window.numrOpenDocument?.(content);
				},
				menuAction: ({ action }: { action: string }) => {
					switch (action) {
						case "new-document":
							window.numrActions?.newDocument?.();
							break;
						case "save-document":
							window.numrActions?.saveDocument?.();
							break;
						case "publish-document":
							window.numrActions?.publishDocument?.();
							break;
						case "refresh-rates":
							window.numrActions?.refreshRates?.();
							break;
						case "toggle-line-wrapping":
							window.numrActions?.toggleLineWrapping?.();
							break;
						default:
							break;
					}
				},
			},
		},
	}),
});

window.numrCopyText = async (text) => {
	electroview.rpc.send.copyText({ text });
	return true;
};

window.addEventListener("numr-publish", (event) => {
	electroview.rpc.send.openExternal({ url: event.detail.url });
});

document.getElementById("btn-hide")?.addEventListener("click", () => {
	electroview.rpc.send.hideWindow({});
});

electroview.rpc.send.webviewReady();
