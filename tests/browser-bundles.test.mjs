import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

function buttonContent(markup, id) {
	return (
		markup.match(
			new RegExp(`<button[^>]*id="${id}"[^>]*>([\\s\\S]*?)</button>`),
		)?.[1] ?? ""
	).replace(/\s+/g, " ").trim();
}

test("browser entrypoints are local self-contained bundles", async () => {
	const [app, component, index, favicon] = await Promise.all([
		readFile(new URL("../app.js", import.meta.url), "utf8"),
		readFile(new URL("../numr-calculator.js", import.meta.url), "utf8"),
		readFile(new URL("../index.html", import.meta.url), "utf8"),
		readFile(new URL("../favicon.svg", import.meta.url), "utf8"),
	]);

	for (const source of [app, component, index]) {
		assert.doesNotMatch(source, /codejar/i);
		assert.doesNotMatch(source, /https:\/\/esm\.sh/);
	}
	assert.match(component, /customElements\.define/);
	assert.match(index, /image\/x-icon[^>]*sizes="16x16 32x32 48x48"/);
	assert.match(index, /image\/png[^>]*sizes="32x32"/);
	assert.match(index, /image\/svg\+xml[^>]*sizes="any"/);
	assert.match(index, /apple-touch-icon[^>]*sizes="180x180"/);
	assert.match(favicon, /<rect[^>]*rx="14"/);
	assert.equal((favicon.match(/<path\b/g) ?? []).length, 2);
});

test("the shared loader exposes the native result-anchor helper", async () => {
	const loader = await readFile(
		new URL("../src/shared/wasm-loader.js", import.meta.url),
		"utf8",
	);
	assert.match(
		loader,
		/expressionPrefixUtf16Len:\s*editorModule\.expressionPrefixUtf16Len/,
	);
});

test("browser surfaces share the semantic color contract", async () => {
	const [styles, desktopStyles, component, editor] = await Promise.all([
		readFile(new URL("../style.css", import.meta.url), "utf8"),
		readFile(new URL("../desktop/desktop.css", import.meta.url), "utf8"),
		readFile(
			new URL("../src/component/numr-calculator.js", import.meta.url),
			"utf8",
		),
		readFile(new URL("../src/shared/numr-editor.js", import.meta.url), "utf8"),
	]);

	for (const token of [
		"bg-primary",
		"bg-secondary",
		"text-primary",
		"text-muted",
		"accent",
		"success",
		"error",
		"border",
		"selection",
	]) {
		assert.match(styles, new RegExp(`--numr-${token}:`));
		assert.match(component + editor, new RegExp(`var\\(--numr-${token}`));
	}
	assert.match(desktopStyles, /var\(--numr-danger\)/);
	assert.doesNotMatch(styles, /shimmer[^;]*infinite/);
	assert.doesNotMatch(styles, /mask-image/);
	assert.match(styles, /\.logo:hover::after[\s\S]*logo-shimmer 850ms linear/);
	assert.match(styles, /prefers-reduced-motion: reduce/);
	for (const token of [
		"number",
		"operator",
		"variable",
		"unit",
		"currency",
		"comment",
		"text",
		"punctuation",
	]) {
		assert.match(styles, new RegExp(`--numr-token-${token}:`));
		assert.match(component, new RegExp(`var\\(--numr-token-${token}`));
	}
	assert.match(styles, /--numr-token-unit:\s*#f4e878/);
	assert.match(styles, /--numr-token-text:\s*#eceef4/);
	assert.match(
		desktopStyles,
		/body\.desktop \.numr-line-numbers\s*{[^}]*min-width:\s*calc\(2ch \+ 11px \+ 1rem\)/s,
	);
});

test("editor view toggles stay connected across public surfaces", async () => {
	const [app, component, index, desktop, bunMain, nativeView] =
		await Promise.all([
			readFile(new URL("../app.js", import.meta.url), "utf8"),
			readFile(new URL("../numr-calculator.js", import.meta.url), "utf8"),
			readFile(new URL("../index.html", import.meta.url), "utf8"),
			readFile(new URL("../desktop/index.html", import.meta.url), "utf8"),
			readFile(new URL("../src/bun/index.ts", import.meta.url), "utf8"),
			readFile(new URL("../src/mainview/index.ts", import.meta.url), "utf8"),
		]);

	assert.match(index, /id="btn-wrap"/);
	assert.match(index, /id="btn-line-numbers"/);
	assert.match(desktop, /id="btn-wrap"/);
	assert.match(desktop, /id="btn-line-numbers"/);
	assert.match(desktop, /id="btn-share"/);
	assert.match(desktop, /<header class="electrobun-webkit-app-region-drag">/);
	assert.match(desktop, /<div class="logo">[\s\S]*draggable="false"/);
	assert.doesNotMatch(desktop, /class="logo[^"\n]*electrobun-webkit-app-region-no-drag/);
	assert.match(desktop, /class="actions electrobun-webkit-app-region-no-drag"/);
	assert.match(desktop, /id="btn-hide"[^>]*aria-label="Hide numr"/);
	assert.match(buttonContent(desktop, "btn-hide"), /^<svg\b/);
	assert.doesNotMatch(buttonContent(desktop, "btn-hide"), /[−–—]/);
	assert.match(
		desktop,
		/id="btn-share"[\s\S]*id="btn-new"[\s\S]*id="btn-save"[\s\S]*id="btn-hide"/,
	);
	for (const markup of [index, desktop]) {
		const header = markup.match(/<header[\s\S]*?<\/header>/)?.[0] ?? "";
		const footer = markup.match(/<footer[\s\S]*?<\/footer>/)?.[0] ?? "";
		assert.doesNotMatch(header, /id="btn-wrap"/);
		assert.doesNotMatch(header, /id="btn-rates"/);
		assert.match(
			footer,
			/id="btn-line-numbers"[\s\S]*id="btn-wrap"[\s\S]*id="btn-rates"/,
		);
		assert.match(markup, /numr-wordmark\.svg/);
		assert.match(footer, /id="decimal-places"[^>]*aria-label="Decimal places"/);
		assert.match(footer, /<option value="">Auto<\/option>/);
	}
	for (const id of ["btn-share", "btn-new", "btn-save", "btn-wrap", "btn-rates"]) {
		assert.equal(buttonContent(desktop, id), buttonContent(index, id));
	}
	assert.match(app, /numr-line-wrapping/);
	assert.match(app, /numr-line-numbers/);
	assert.match(component, /["']wrap["']/);
	assert.match(bunMain, /toggle-line-wrapping/);
	assert.match(bunMain, /numr-tray-template\.png/);
	assert.match(bunMain, /numr-tray\.png/);
	assert.match(bunMain, /numr-tray\.ico/);
	assert.match(bunMain, /clipboardWriteText/);
	assert.match(nativeView, /numrCopyText/);
	assert.match(app, /numrCopyText/);
	assert.match(nativeView, /toggle-line-wrapping/);
});
