export const STORAGE_KEYS = Object.freeze({
	document: "numr-document",
	lineWrapping: "numr-line-wrapping",
	lineNumbers: "numr-line-numbers",
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
