import assert from "node:assert/strict";
import test from "node:test";
import { validateDecimalPlaces, parseDecimalPlaces, loadDecimalPlaces, saveDecimalPlaces } from "../src/shared/decimal-places.js";
import { createSafeStorage, STORAGE_KEYS } from "../src/shared/storage.js";

test("precision accepts every integer boundary and explicit automatic formatting", () => {
	assert.equal(validateDecimalPlaces(undefined), undefined);
	assert.equal(parseDecimalPlaces(null), undefined);
	assert.equal(parseDecimalPlaces(""), undefined);
	for (let value = 0; value <= 28; value++) {
		assert.equal(validateDecimalPlaces(value), value);
		assert.equal(parseDecimalPlaces(String(value)), value);
	}
});

test("precision rejects fractions, overflow, non-finite and coercible values", () => {
	for (const value of [-1, 29, 1.5, NaN, Infinity, -Infinity, 4294967296, "2", null, true, {}, []]) {
		assert.throws(() => validateDecimalPlaces(value), RangeError);
	}
	for (const text of ["1.5", "29", "-1", "NaN", "Infinity", "4294967296", "2px", " 2", "2 ", "02", "2e0", "0x2", "undefined", "null", "{}"]) {
		assert.throws(() => parseDecimalPlaces(text), RangeError);
	}
});

test("preference round-trips zero and maximum; reset removes only the override", () => {
	const values = new Map([[STORAGE_KEYS.document, "unchanged"]]);
	const storage = createSafeStorage({
		getItem: (key) => values.get(key) ?? null,
		setItem: (key, value) => values.set(key, value),
		removeItem: (key) => values.delete(key),
	});
	assert.equal(loadDecimalPlaces(storage), undefined);
	for (const value of [0, 4, 28]) {
		assert.equal(saveDecimalPlaces(value, storage), true);
		assert.equal(loadDecimalPlaces(storage), value);
	}
	assert.throws(() => saveDecimalPlaces(2.5, storage), RangeError);
	assert.equal(loadDecimalPlaces(storage), 28);
	assert.equal(saveDecimalPlaces(undefined, storage), true);
	assert.equal(storage.getItem(STORAGE_KEYS.decimalPlaces), null);
	assert.equal(storage.getItem(STORAGE_KEYS.document), "unchanged");
});

test("corrupt or blocked preferences preserve automatic formatting", () => {
	for (const value of ["1.5", "29", "-1", "NaN", "{}", "true", " ", "null"]) {
		assert.equal(loadDecimalPlaces({ getItem: () => value }), undefined);
	}
	const storage = createSafeStorage({
		getItem() { throw new Error("blocked"); },
		setItem() { throw new Error("full"); },
		removeItem() { throw new Error("blocked"); },
	});
	assert.equal(loadDecimalPlaces(storage), undefined);
	assert.equal(saveDecimalPlaces(4, storage), false);
	assert.equal(saveDecimalPlaces(undefined, storage), false);
	assert.equal(createSafeStorage(null).removeItem("missing"), false);
});
