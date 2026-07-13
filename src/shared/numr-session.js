import { loadNumrWasm } from "./wasm-loader.js";

/**
 * Stable JavaScript boundary around the generated WASM APIs.
 * Views consume plain objects and never parse WASM payloads themselves.
 */
export class NumrSession {
	static async create(options = {}) {
		const wasm = await loadNumrWasm(options);
		return new NumrSession({
			engine: new wasm.WasmEngine(),
			tokenize: wasm.tokenize,
			tokenizeWithVariables: wasm.tokenizeWithVariables,
			expressionPrefixUtf16Len: wasm.expressionPrefixUtf16Len,
		});
	}

	constructor({
		engine,
		tokenize,
		tokenizeWithVariables,
		expressionPrefixUtf16Len,
	}) {
		this.engine = engine;
		this.tokenize = tokenize;
		this.tokenizeWithVariables = tokenizeWithVariables;
		this.expressionPrefixUtf16Len = expressionPrefixUtf16Len;
		this.variableNames = "";
	}

	evaluateDocument(content) {
		const document = parseWasmJson(
			this.engine.eval_document_full(content),
			"document",
		);
		this.variableNames = document.variable_names || "";
		return { results: document.results, totals: document.totals };
	}

	getVariableNames() {
		return this.variableNames;
	}

	getCryptoCurrencies() {
		try {
			return parseWasmJson(
				this.engine.get_currency_catalog(),
				"currency catalog",
			).filter(
				({ is_crypto: isCrypto, coingecko_id: id }) => isCrypto && id,
			);
		} catch {
			return [];
		}
	}

	tokenizeLine(text, variableNames = "") {
		if (!text) return [];
		const knownVariables =
			typeof variableNames === "string" ? variableNames : "";
		const payload =
			knownVariables && this.tokenizeWithVariables
				? this.tokenizeWithVariables(text, knownVariables)
				: this.tokenize(text);
		try {
			return parseWasmJson(payload, "tokens");
		} catch {
			return [];
		}
	}

	expressionPrefixLength(text) {
		return this.expressionPrefixUtf16Len(text);
	}

	applyRates(rates) {
		this.engine.apply_rates(JSON.stringify(rates));
	}

	dispose() {
		this.engine.free?.();
	}
}

export function parseWasmJson(payload, context = "response") {
	try {
		return JSON.parse(payload);
	} catch (cause) {
		throw new Error(`Invalid ${context} JSON from numr WASM`, { cause });
	}
}
