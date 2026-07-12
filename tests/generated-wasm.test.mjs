import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import init, { WasmEngine } from "../pkg/core/numr_core.js";

let initialized;
function initializeCore() {
	initialized ??= readFile(
		new URL("../pkg/core/numr_core_bg.wasm", import.meta.url),
	).then((module_or_path) => init({ module_or_path }));
	return initialized;
}

test("generated WASM exposes the 0.7 catalog and validated rate contract", async () => {
	await initializeCore();
	const engine = new WasmEngine();
	try {
		const catalog = JSON.parse(engine.get_currency_catalog());
		assert.ok(
			catalog.some(
				({ code, is_crypto: isCrypto, coingecko_id: id }) =>
					code === "BTC" && isCrypto && id === "bitcoin",
			),
		);
		assert.equal(engine.apply_rates(JSON.stringify({ EUR: 0.9 })), 1);
		assert.throws(
			() => engine.apply_rates(JSON.stringify({ EUR: 0 })),
			/invalid exchange rates/,
		);
	} finally {
		engine.free();
	}
});

test("generated WASM evaluates statistics and typed angles", async () => {
	await initializeCore();
	const engine = new WasmEngine();
	try {
		const document = JSON.parse(
			engine.eval_document_full(
				"median(10, 30, 20)\nclamp(120, 0, 100)\nsin(90°)\n90° to rad\n90° to m",
			),
		);
		assert.deepEqual(
			document.results.map(({ result, is_error: isError }) => [result, isError]),
			[
				["20", false],
				["100", false],
				["1", false],
				["1.57 rad", false],
				["Error: Cannot convert ° to m", true],
			],
		);
	} finally {
		engine.free();
	}
});
