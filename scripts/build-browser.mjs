#!/usr/bin/env bun

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const wasmFiles = [
	"pkg/core/numr_core.js",
	"pkg/core/numr_core_bg.wasm",
	"pkg/editor/numr_editor.js",
	"pkg/editor/numr_editor_bg.wasm",
];
const hash = createHash("sha256");

for (const path of wasmFiles) hash.update(readFileSync(resolve(rootDir, path)));

const wasmAssetVersion = hash.digest("hex").slice(0, 10);
const result = await Bun.build({
	entrypoints: [
		resolve(rootDir, "src/web/app.js"),
		resolve(rootDir, "src/component/numr-calculator.js"),
	],
	outdir: rootDir,
	target: "browser",
	format: "esm",
	splitting: false,
	minify: true,
	naming: "[name].[ext]",
	define: {
		__NUMR_ASSET_VERSION__: JSON.stringify(wasmAssetVersion),
	},
});

if (!result.success) {
	for (const log of result.logs) console.error(log);
	process.exit(1);
}

console.log(`Built browser bundles with WASM assets ${wasmAssetVersion}`);
