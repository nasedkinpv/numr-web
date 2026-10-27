import { safeStorage, STORAGE_KEYS } from "./storage.js";

/** Undefined preserves the engine's legacy, value-specific formatting. */
export function validateDecimalPlaces(value) {
	if (value === undefined) return value;
	if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 28) {
		throw new RangeError("Decimal places must be an integer from 0 to 28, or undefined");
	}
	return value;
}

/** Parse HTML/storage text without truncation, clamping, or numeric coercion. */
export function parseDecimalPlaces(value) {
	if (value === null || value === "") return undefined;
	if (typeof value !== "string" || !/^(?:[0-9]|1[0-9]|2[0-8])$/.test(value)) {
		throw new RangeError("Decimal places must be an integer from 0 to 28");
	}
	return validateDecimalPlaces(Number(value));
}

export function loadDecimalPlaces(storage = safeStorage) {
	try {
		return parseDecimalPlaces(storage.getItem(STORAGE_KEYS.decimalPlaces));
	} catch {
		return undefined;
	}
}

export function saveDecimalPlaces(value, storage = safeStorage) {
	validateDecimalPlaces(value);
	return value === undefined
		? storage.removeItem(STORAGE_KEYS.decimalPlaces)
		: storage.setItem(STORAGE_KEYS.decimalPlaces, String(value));
}
