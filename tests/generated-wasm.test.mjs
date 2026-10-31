import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { NumrSession } from "../src/shared/numr-session.js";
import init, { WasmEngine } from "../pkg/core/numr_core.js";
import initEditor, {
	expressionPrefixUtf16Len,
	tokenize,
} from "../pkg/editor/numr_editor.js";

let initialized;
function initializeCore() {
	initialized ??= readFile(
		new URL("../pkg/core/numr_core_bg.wasm", import.meta.url),
	).then((module_or_path) => init({ module_or_path }));
	return initialized;
}

let editorInitialized;
function initializeEditor() {
	editorInitialized ??= readFile(
		new URL("../pkg/editor/numr_editor_bg.wasm", import.meta.url),
	).then((module_or_path) => initEditor({ module_or_path }));
	return editorInitialized;
}

test("generated WASM rounds stored values with midpoint-even ties and bounded precision", async () => {
	await initializeCore();
	const engine = new WasmEngine();
	try {
		engine.set_decimal_places(4);
		const content = [
			"rounded = round(1.234567, 4)",
			"rounded * 10000",
			"round(1.245, 2)",
			"round(1.255, 2)",
			"round(-1.245, 2)",
			"round(-1.255, 2)",
			"round(2.5, 0)",
			"round(3.5, 0)",
			"round(2.5)",
		].join("\n");
		const document = JSON.parse(engine.eval_document_full(content));
		assert.deepEqual(document.results.map(({ result }) => result), [
			"1.2346", "12346", "1.2400", "1.2600", "-1.2400", "-1.2600", "2", "4", "2",
		]);
		assert.ok(document.results.every(({ is_error }) => !is_error));
		for (const precision of ["-1", "1.5", "29"]) {
			const invalid = JSON.parse(engine.eval_document_full(`round(1.23, ${precision})`)).results[0];
			assert.equal(invalid.is_error, true);
			assert.equal(invalid.result, "Error: round precision must be an integer between 0 and 28");
		}
		engine.set_decimal_places(28);
		assert.equal(JSON.parse(engine.eval_document_full("round(1.234567, 28)")).results[0].result, `1.234567${"0".repeat(22)}`);
	} finally {
		engine.free();
	}
});

test("real WASM session preserves rounded arithmetic independently of display precision", async () => {
	await initializeCore();
	await initializeEditor();
	const session = new NumrSession({ engine: new WasmEngine(), tokenize });
	try {
		const content = "rounded = round(1.234567, 4)\nrounded * 10000";
		for (const [precision, expected] of [[2, "1.23"], [4, "1.2346"]]) {
			session.setDecimalPlaces(precision);
			const document = session.evaluateDocument(content);
			assert.deepEqual(document.results.map(({ result }) => result), [expected, "12346"]);
			assert.ok(document.results.every(({ is_error }) => !is_error));
			assert.equal(session.getVariableNames(), "rounded");
		}
		const invalid = session.evaluateDocument("round(1.23, 29)");
		assert.equal(invalid.results[0].is_error, true);
		assert.match(invalid.results[0].result, /round precision must be an integer between 0 and 28/);
		assert.equal(session.evaluateDocument("round(1.255, 2)").results[0].result, "1.2600");
	} finally {
		session.dispose();
	}
});

test("generated editor WASM anchors results before trailing comments", async () => {
	await initializeEditor();
	for (const [input, prefix] of [
		["100 + 50 // note", "100 + 50"],
		["90° to rad   # angle", "90° to rad"],
		["🧮 + 1 // unicode", "🧮 + 1"],
	]) {
		assert.equal(expressionPrefixUtf16Len(input), prefix.length);
	}
});

test("generated WASM exposes the currency catalog and validated rate contract", async () => {
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

test("generated WASM precision validates JS numbers, re-evaluates totals, and resets", async () => {
	await initializeCore();
	const engine = new WasmEngine();
	const other = new WasmEngine();
	try {
		assert.equal(typeof engine.set_decimal_places, "function");
		const content = "price = $12.34567";
		const original = engine.eval_document_full(content);
		engine.set_decimal_places(4);
		const precise = JSON.parse(engine.eval_document_full(content));
		assert.equal(precise.results[0].result, "$12.3457");
		assert.deepEqual(precise.totals, ["$12.3457"]);
		assert.equal(other.eval_document_full(content), original);
		for (const value of [-1, 1.5, 29, 4294967296, NaN, Infinity, -Infinity]) {
			assert.throws(() => engine.set_decimal_places(value), /decimal|integer|28/i);
			assert.deepEqual(JSON.parse(engine.eval_document_full(content)), precise);
		}
		engine.set_decimal_places(0);
		assert.equal(JSON.parse(engine.eval_document_full(content)).results[0].result, "$12");
		engine.set_decimal_places(28);
		assert.equal(JSON.parse(engine.eval_document_full("1/3")).results[0].result, `0.${"3".repeat(28)}`);
		engine.set_decimal_places(undefined);
		assert.equal(engine.eval_document_full(content), original);
		engine.set_decimal_places(2);
		const arithmetic = JSON.parse(engine.eval_document_full("third = 1/3\nthird * 3"));
		assert.deepEqual(arithmetic.results.map(({ result }) => result), ["0.33", "1"]);
		engine.set_decimal_places(4);
		const typed = JSON.parse(engine.eval_document_full("100 mi in km\n1.234567%\n1.234567°\n22 to hex\n22 to bin"));
		assert.deepEqual(typed.results.map(({ result }) => result), ["160.9344 km", "1.2346%", "1.2346°", "0x16", "0b10110"]);
	} finally {
		engine.free();
		other.free();
	}
});

test("generated WASM includes tenge aliases, rates, tokenization, and totals", async () => {
	await initializeCore();
	await initializeEditor();
	for (const input of ["100 KZT", "100 tenge", "100 ₸"]) {
		assert.ok(JSON.parse(tokenize(input)).some(({ token_type }) => token_type === "currency"));
	}
	const engine = new WasmEngine();
	try {
		const catalog = JSON.parse(engine.get_currency_catalog());
		assert.ok(catalog.some(({ code, symbol, is_crypto }) => code === "KZT" && symbol === "₸" && !is_crypto));
		assert.equal(engine.apply_rates(JSON.stringify({ KZT: 450 })), 1);
		const content = "100 KZT\n100 tenge\n100 ₸\n1 USD in KZT";
		const document = JSON.parse(engine.eval_document_full(content));
		assert.deepEqual(document.results.map(({ result, is_error }) => [result, is_error]), [["100.00₸", false], ["100.00₸", false], ["100.00₸", false], ["450.00₸", false]]);
		assert.deepEqual(document.totals, ["750.00₸"]);
		assert.deepEqual(JSON.parse(engine.eval_document_full(content)), document);
		engine.set_decimal_places(0);
		assert.deepEqual(JSON.parse(engine.eval_document_full(content)).totals, ["750₸"]);
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
