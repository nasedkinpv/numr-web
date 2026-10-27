export const STORAGE_KEYS = Object.freeze({
	document: "numr-document",
	lineWrapping: "numr-line-wrapping",
	lineNumbers: "numr-line-numbers",
	decimalPlaces: "numr-decimal-places",
	rates: "numr-rates",
	ratesTimestamp: "numr-rates-timestamp",
});

export function createSafeStorage(storage) {
	function resolve() {
		if (storage !== undefined) return storage;
		try {
			return globalThis.localStorage;
		} catch {
			return null;
		}
	}

	return Object.freeze({
		removeItem(key) {
			try {
				const target = resolve();
				if (!target) return false;
				target.removeItem(String(key));
				return true;
			} catch {
				return false;
			}
		},
		getItem(key) {
			try {
				const value = resolve()?.getItem(String(key));
				return value == null ? null : String(value);
			} catch {
				return null;
			}
		},
		setItem(key, value) {
			try {
				const target = resolve();
				if (!target) return false;
				target.setItem(String(key), String(value));
				return true;
			} catch {
				return false;
			}
		},
	});
}

export const safeStorage = createSafeStorage();
