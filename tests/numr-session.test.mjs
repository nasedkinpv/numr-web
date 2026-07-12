import assert from "node:assert/strict";
import test from "node:test";

import { NumrSession } from "../src/shared/numr-session.js";

function createSession(overrides = {}) {
	const engine = {
		eval_document: () => '[{"input":"1+1","result":"2"}]',
		eval_document_full: () =>
			'{"results":[{"input":"1+1","result":"2"}],"totals":["2"],"variable_names":"x"}',
		get_totals: () => '["2"]',
		get_variable_names: () => "x",
		apply_rates: () => {},
		clear: () => {},
		...overrides,
	};
	return new NumrSession({
		engine,
		tokenize: (text) => JSON.stringify([{ text, token_type: "text" }]),
		tokenizeWithVariables: null,
	});
}

test("normalizes document evaluation and totals", () => {
	const session = createSession();
	assert.deepEqual(session.evaluateDocument("1+1"), {
		results: [{ input: "1+1", result: "2" }],
		totals: ["2"],
	});
	assert.equal(session.getVariableNames(), "x");
});

test("keeps compatibility with the legacy split document boundary", () => {
	const session = createSession({ eval_document_full: null });
	assert.deepEqual(session.evaluateDocument("1+1"), {
		results: [{ input: "1+1", result: "2" }],
		totals: ["2"],
	});
	assert.equal(session.getVariableNames(), "x");
});

test("surfaces malformed WASM payloads", () => {
	const session = createSession({ eval_document_full: () => "not-json" });
	assert.throws(() => session.evaluateDocument("1+1"), /Invalid document JSON/);
});

test("tokenization falls back without breaking the view", () => {
	const session = createSession();
	assert.deepEqual(session.tokenizeLine("hello"), [
		{ text: "hello", token_type: "text" },
	]);
});

test("tokenization rejects non-string variable metadata at the WASM boundary", () => {
	let plainCalls = 0;
	let variableCalls = 0;
	const base = createSession();
	const session = new NumrSession({
		engine: base.engine,
		tokenize: (text) => {
			plainCalls += 1;
			return JSON.stringify([{ text, token_type: "text" }]);
		},
		tokenizeWithVariables: () => {
			variableCalls += 1;
			return "[]";
		},
	});

	assert.equal(session.tokenizeLine("$3.00", 1)[0].text, "$3.00");
	assert.equal(plainCalls, 1);
	assert.equal(variableCalls, 0);
});

test("derives rate-provider currencies from the core catalog", () => {
	const session = createSession({
		get_currency_catalog: () =>
			JSON.stringify([
				{ code: "USD", is_crypto: false, coingecko_id: null },
				{ code: "BTC", is_crypto: true, coingecko_id: "bitcoin" },
			]),
	});
	assert.deepEqual(session.getCryptoCurrencies(), [
		{ code: "BTC", is_crypto: true, coingecko_id: "bitcoin" },
	]);
});
