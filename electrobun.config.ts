import type { ElectrobunConfig } from "electrobun";

export default {
	app: {
		name: "numr",
		identifier: "cc.numr.desktop",
		version: "0.8.0",
		fileAssociations: [
			{
				name: "numr document",
				ext: ["numr"],
				role: "Editor",
			},
		],
	},
	build: {
		bun: {
			entrypoint: "src/bun/index.ts",
		},
		views: {
			mainview: {
				entrypoint: "src/mainview/index.ts",
			},
		},
		copy: {
			"desktop/numr-tray-sf-template.png":
				"views/assets/numr-tray-sf-template.png",
			"desktop/index.html": "views/mainview/index.html",
			"desktop/desktop.css": "views/mainview/desktop.css",
			"app.js": "views/mainview/app.js",
			"style.css": "views/mainview/style.css",
			"NUMR.svg": "views/mainview/NUMR.svg",
			"favicon.ico": "views/mainview/favicon.ico",
			"favicon.svg": "views/mainview/favicon.svg",
			"favicon.png": "views/mainview/favicon.png",
			"apple-touch-icon.png": "views/mainview/apple-touch-icon.png",
			"pkg/core/numr_core.js": "views/mainview/pkg/core/numr_core.js",
			"pkg/core/numr_core_bg.wasm": "views/mainview/pkg/core/numr_core_bg.wasm",
			"pkg/editor/numr_editor.js": "views/mainview/pkg/editor/numr_editor.js",
			"pkg/editor/numr_editor_bg.wasm":
				"views/mainview/pkg/editor/numr_editor_bg.wasm",
		},
		mac: {
			bundleCEF: false,
			defaultRenderer: "native",
		},
		win: {
			bundleCEF: false,
			defaultRenderer: "native",
		},
		linux: {
			bundleCEF: true,
			defaultRenderer: "cef",
		},
	},
} satisfies ElectrobunConfig;
