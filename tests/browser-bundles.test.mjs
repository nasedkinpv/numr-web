import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("browser entrypoints are local self-contained bundles", async () => {
	const [app, component, index] = await Promise.all([
		readFile(new URL("../app.js", import.meta.url), "utf8"),
		readFile(new URL("../numr-calculator.js", import.meta.url), "utf8"),
		readFile(new URL("../index.html", import.meta.url), "utf8"),
	]);

	for (const source of [app, component, index]) {
		assert.doesNotMatch(source, /codejar/i);
		assert.doesNotMatch(source, /https:\/\/esm\.sh/);
	}
	assert.match(component, /customElements\.define/);
});
