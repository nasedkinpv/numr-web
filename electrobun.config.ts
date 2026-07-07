import type { ElectrobunConfig } from "electrobun";

export default {
	app: {
		name: "numr",
		identifier: "cc.numr.desktop",
		version: "0.2.1",
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
			"src/shared/share-codec.js": "views/mainview/src/shared/share-codec.js",
			"style.css": "views/mainview/style.css",
			"NUMR.svg": "views/mainview/NUMR.svg",
			"favicon.ico": "views/mainview/favicon.ico",
			"favicon.svg": "views/mainview/favicon.svg",
			"favicon.png": "views/mainview/favicon.png",
			"apple-touch-icon.png": "views/mainview/apple-touch-icon.png",
			"pkg/core/numr_core.js": "views/mainview/pkg/core/numr_core.js",
			"pkg/core/numr_core_bg.wasm": "views/mainview/pkg/core/numr_core_bg.wasm",
			"pkg/core/numr_core_bg.wasm.d.ts":
				"views/mainview/pkg/core/numr_core_bg.wasm.d.ts",
			"pkg/core/numr_core.d.ts": "views/mainview/pkg/core/numr_core.d.ts",
			"pkg/core/package.json": "views/mainview/pkg/core/package.json",
			"pkg/editor/numr_editor.js": "views/mainview/pkg/editor/numr_editor.js",
			"pkg/editor/numr_editor_bg.wasm":
				"views/mainview/pkg/editor/numr_editor_bg.wasm",
			"pkg/editor/numr_editor_bg.wasm.d.ts":
				"views/mainview/pkg/editor/numr_editor_bg.wasm.d.ts",
			"pkg/editor/numr_editor.d.ts":
				"views/mainview/pkg/editor/numr_editor.d.ts",
			"pkg/editor/package.json": "views/mainview/pkg/editor/package.json",
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
