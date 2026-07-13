#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function resolvePath(relativePath) {
	return resolve(rootDir, relativePath);
}

function readText(relativePath) {
	return readFileSync(resolvePath(relativePath), "utf8");
}

function readBuffer(relativePath) {
	return readFileSync(resolvePath(relativePath));
}

function writeText(relativePath, content) {
	writeFileSync(resolvePath(relativePath), content);
}

function shortHash(buffers) {
	const hash = createHash("sha256");

	for (const buffer of buffers) {
		hash.update(buffer);
	}

	return hash.digest("hex").slice(0, 10);
}

function hashFile(relativePath) {
	return shortHash([readBuffer(relativePath)]);
}

function hashFiles(relativePaths) {
	return shortHash(relativePaths.map(readBuffer));
}

function replaceRequired(content, pattern, replacement, label) {
	if (!pattern.test(content)) {
		throw new Error(`Failed to update ${label}`);
	}

	return content.replace(pattern, replacement);
}

const assetVersions = {
	logo: hashFile("NUMR.svg"),
	faviconIco: hashFile("favicon.ico"),
	faviconSvg: hashFile("favicon.svg"),
	faviconPng: hashFile("favicon.png"),
	appleTouch: hashFile("apple-touch-icon.png"),
};

// wasm-pack creates nested `*` .gitignore files. An explicit .npmignore keeps
// generated bindings publishable while retaining those repository defaults.
writeText("pkg/core/.npmignore", "# Generated WASM package files are published.\n");
writeText("pkg/editor/.npmignore", "# Generated WASM package files are published.\n");

const wasmAssetVersion = hashFiles([
	"pkg/core/numr_core.js",
	"pkg/core/numr_core_bg.wasm",
	"pkg/editor/numr_editor.js",
	"pkg/editor/numr_editor_bg.wasm",
]);

const appVersion = hashFile("app.js");
const calculatorVersion = hashFile("numr-calculator.js");

let styleCss = readText("style.css");
styleCss = replaceRequired(
	styleCss,
	/url\('NUMR\.svg(?:\?v=[^']+)?'\)/g,
	"url('NUMR.svg')",
	"style.css NUMR.svg references",
);
const styleVersion = shortHash([Buffer.from(styleCss)]);
writeText("style.css", styleCss);

let indexHtml = readText("index.html");
indexHtml = replaceRequired(
	indexHtml,
	/href="\/favicon\.ico(?:\?v=[^"]+)?"/,
	`href="/favicon.ico?v=${assetVersions.faviconIco}"`,
	"index.html favicon.ico",
);
indexHtml = replaceRequired(
	indexHtml,
	/href="\/favicon\.svg(?:\?v=[^"]+)?"/,
	`href="/favicon.svg?v=${assetVersions.faviconSvg}"`,
	"index.html favicon.svg",
);
indexHtml = replaceRequired(
	indexHtml,
	/href="\/favicon\.png(?:\?v=[^"]+)?"/,
	`href="/favicon.png?v=${assetVersions.faviconPng}"`,
	"index.html favicon.png",
);
indexHtml = replaceRequired(
	indexHtml,
	/href="\/apple-touch-icon\.png(?:\?v=[^"]+)?"/,
	`href="/apple-touch-icon.png?v=${assetVersions.appleTouch}"`,
	"index.html apple-touch-icon.png",
);
indexHtml = replaceRequired(
	indexHtml,
	/href="style\.css(?:\?v=[^"]+)?"/,
	`href="style.css?v=${styleVersion}"`,
	"index.html style.css",
);
indexHtml = replaceRequired(
	indexHtml,
	/href="\/pkg\/core\/numr_core_bg\.wasm(?:\?v=[^"]+)?"/,
	`href="/pkg/core/numr_core_bg.wasm?v=${wasmAssetVersion}"`,
	"index.html core wasm preload",
);
indexHtml = replaceRequired(
	indexHtml,
	/href="\/pkg\/editor\/numr_editor_bg\.wasm(?:\?v=[^"]+)?"/,
	`href="/pkg/editor/numr_editor_bg.wasm?v=${wasmAssetVersion}"`,
	"index.html editor wasm preload",
);
indexHtml = replaceRequired(
	indexHtml,
	/src="NUMR\.svg(?:\?v=[^"]+)?"/,
	`src="NUMR.svg?v=${assetVersions.logo}"`,
	"index.html logo image",
);
indexHtml = replaceRequired(
	indexHtml,
	/src="app\.js(?:\?v=[^"]+)?"/,
	`src="app.js?v=${appVersion}"`,
	"index.html app.js",
);
writeText("index.html", indexHtml);

let demoHtml = readText("demo.html");
demoHtml = replaceRequired(
	demoHtml,
	/numr-calculator\.js\?v=[^"&<\s]+/g,
	`numr-calculator.js?v=${calculatorVersion}`,
	"demo.html numr-calculator.js",
);
writeText("demo.html", demoHtml);

let readme = readText("README.md");
readme = replaceRequired(
	readme,
	/https:\/\/numr\.cc\/numr-calculator\.js\?v=[^"\s]+/,
	`https://numr.cc/numr-calculator.js?v=${calculatorVersion}`,
	"README.md numr-calculator.js",
);
writeText("README.md", readme);

console.log(`Stamped app.js?v=${appVersion}`);
console.log(`Stamped style.css?v=${styleVersion}`);
console.log(`Stamped numr-calculator.js?v=${calculatorVersion}`);
console.log(`Stamped wasm assets?v=${wasmAssetVersion}`);
