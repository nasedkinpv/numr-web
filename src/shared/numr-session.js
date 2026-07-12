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
		});
	}

	constructor({ engine, tokenize, tokenizeWithVariables }) {
		this.engine = engine;
		this.tokenize = tokenize;
		this.tokenizeWithVariables = tokenizeWithVariables;
		this.variableNames = "";
	}

	evaluateDocument(content) {
		if (this.engine.eval_document_full) {
			const document = parseWasmJson(
				this.engine.eval_document_full(content),
				"document",
			);
			this.variableNames = document.variable_names || "";
			return { results: document.results, totals: document.totals };
		}

		const evaluation = {
			results: parseWasmJson(this.engine.eval_document(content), "document"),
			totals: this.getTotals(),
		};
		this.variableNames = this.engine.get_variable_names?.() || "";
		return evaluation;
	}

	getTotals() {
		return parseWasmJson(this.engine.get_totals(), "totals");
	}

	getVariableNames() {
		return this.variableNames || this.engine.get_variable_names?.() || "";
	}

	getCryptoCurrencies() {
		const payload = this.engine.get_currency_catalog?.();
		if (!payload) return [];
		try {
			return parseWasmJson(payload, "currency catalog").filter(
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

	applyRates(rates) {
		this.engine.apply_rates(JSON.stringify(rates));
	}

	clear() {
		this.engine.clear();
		this.variableNames = "";
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
