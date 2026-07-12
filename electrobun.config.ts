import type { ElectrobunConfig } from "electrobun";

export default {
	app: {
		name: "numr",
		identifier: "cc.numr.desktop",
		version: "0.7.0",
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
			"desktop/index.html": "views/mainview/index.html",
			"desktop/desktop.css": "views/mainview/desktop.css",
			"app.js": "views/mainview/app.js",
			"src/shared/wasm-loader.js": "views/mainview/src/shared/wasm-loader.js",
			"src/shared/numr-session.js": "views/mainview/src/shared/numr-session.js",
			"src/shared/rates-service.js": "views/mainview/src/shared/rates-service.js",
			"src/shared/share-codec.js": "views/mainview/src/shared/share-codec.js",
			"src/shared/token-renderer.js":
				"views/mainview/src/shared/token-renderer.js",
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
