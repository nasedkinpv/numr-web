import assert from "node:assert/strict";
import test from "node:test";

import { createSafeStorage } from "../src/shared/storage.js";

test("safe storage preserves Web Storage string semantics", () => {
	const values = new Map();
	const storage = createSafeStorage({
		getItem: (key) => values.get(key) ?? null,
		setItem: (key, value) => values.set(key, value),
	});

	assert.equal(storage.getItem("missing"), null);
	assert.equal(storage.setItem("empty", ""), true);
	assert.equal(storage.getItem("empty"), "");
});

test("safe storage degrades to an unavailable store", () => {
	const storage = createSafeStorage({
		getItem: () => {
			throw new DOMException("blocked", "SecurityError");
		},
		setItem: () => {
			throw new DOMException("full", "QuotaExceededError");
		},
	});

	assert.equal(storage.getItem("document"), null);
	assert.equal(storage.setItem("document", "content"), false);
});
