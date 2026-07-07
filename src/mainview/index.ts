import { Electroview } from "electrobun/view";

declare global {
	interface Window {
		numrActions?: Record<string, () => void>;
		numrOpenDocument?: (
			content: string,
			source?: string,
			filename?: string,
		) => boolean;
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
				openDocument: ({
					content,
					path,
				}: {
					content: string;
					path: string;
				}) => {
					window.numrOpenDocument?.(content, "file_association", path);
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
						default:
							break;
					}
				},
			},
		},
	}),
});

window.addEventListener("numr-publish", (event) => {
	electroview.rpc.send.openExternal({ url: event.detail.url });
});

electroview.rpc.send.webviewReady();
