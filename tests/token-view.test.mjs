import assert from "node:assert/strict";
import test from "node:test";

import {
	tokenClassName,
	tokenRanges,
	tokenizeForDisplay,
} from "../src/shared/token-view.js";

test("token classes accept only tokenizer-owned names", () => {
	assert.equal(tokenClassName("currency"), "numr-token-currency");
	assert.equal(tokenClassName('"><script'), "numr-token-text");
	assert.equal(tokenClassName(""), "numr-token-text");
});

test("token ranges follow CodeMirror UTF-16 document offsets", () => {
	const session = {
		tokenizeLine() {
			return [
				{ text: "price", token_type: "variable" },
				{ text: " ", token_type: "whitespace" },
				{ text: "+", token_type: "operator" },
				{ text: " ", token_type: "whitespace" },
				{ text: "💵", token_type: "currency" },
			];
		},
	};

	assert.deepEqual(tokenRanges(session, "price + 💵"), [
		{ from: 0, to: 5, className: "numr-token-variable" },
		{ from: 6, to: 7, className: "numr-token-operator" },
		{ from: 8, to: 10, className: "numr-token-currency" },
	]);
});

test("display tokenization falls back to text when no tokenizer is ready", () => {
	assert.deepEqual(tokenizeForDisplay(null, "10 + 20"), [
		{ text: "10 + 20", token_type: "text" },
	]);
	assert.deepEqual(tokenizeForDisplay(null, ""), []);
});
