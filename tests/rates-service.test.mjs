import assert from "node:assert/strict";
import test from "node:test";

import { RatesService } from "../src/shared/rates-service.js";

class MemoryStorage {
	#values = new Map();
	getItem(key) {
		return this.#values.get(key) ?? null;
	}
	setItem(key, value) {
		this.#values.set(key, value);
	}
}

function response(data, { ok = true, status = 200 } = {}) {
	return { ok, status, json: async () => data };
}

function session() {
	return {
		applied: [],
		applyRates(rates) {
			this.applied.push(rates);
		},
		getCryptoCurrencies: () => [{ code: "BTC", coingecko_id: "bitcoin" }],
	};
}

test("loads a fresh non-empty cache", () => {
	const storage = new MemoryStorage();
	storage.setItem("numr-rates", JSON.stringify({ EUR: 0.9 }));
	storage.setItem("numr-rates-timestamp", "1000");
	const target = session();
	const service = new RatesService(target, { storage, now: () => 1500 });
	assert.deepEqual(service.loadCached()?.rates, { EUR: 0.9 });
	assert.deepEqual(target.applied, [{ EUR: 0.9 }]);
});

test("rejects future cache timestamps", () => {
	const storage = new MemoryStorage();
	storage.setItem("numr-rates", JSON.stringify({ EUR: 0.9 }));
	storage.setItem("numr-rates-timestamp", "2000");
	const service = new RatesService(session(), { storage, now: () => 1500 });
	assert.equal(service.loadCached(), null);
});

test("does not accept rates without a cache timestamp", () => {
	const storage = new MemoryStorage();
	storage.setItem("numr-rates", JSON.stringify({ EUR: 0.9 }));
	const service = new RatesService(session(), { storage, now: () => 1500 });
	assert.equal(service.loadCached(), null);
});

test("coalesces refreshes and keeps partial provider success", async () => {
	let calls = 0;
	const target = session();
	const fetchImpl = async (url) => {
		calls += 1;
		return String(url).includes("open.er-api")
			? response({ rates: { EUR: 0.91 } })
			: response({}, { ok: false, status: 503 });
	};
	const service = new RatesService(target, {
		storage: new MemoryStorage(),
		fetchImpl,
		now: () => 42,
	});
	const first = service.refresh();
	const second = service.refresh();
	assert.equal(first, second);
	const result = await first;
	assert.equal(calls, 2);
	assert.equal(result.warning, true);
	assert.deepEqual(target.applied, [{ EUR: 0.91 }]);
});

test("fails instead of caching an empty response", async () => {
	const service = new RatesService(session(), {
		storage: new MemoryStorage(),
		fetchImpl: async () => response({}),
	});
	await assert.rejects(service.refresh(), /no usable rates/);
});

test("keeps rate-limit errors concise", async () => {
	const service = new RatesService(session(), {
		storage: new MemoryStorage(),
		fetchImpl: async () => response({}, { ok: false, status: 429 }),
	});
	await assert.rejects(
		service.refresh(),
		/^Error: Rate provider returned HTTP 429$/,
	);
});

test("disposing cancels refresh before rates reach the WASM session", async () => {
	const target = session();
	const fetchImpl = (_url, { signal }) =>
		new Promise((_resolve, reject) => {
			signal.addEventListener("abort", () => reject(new Error("aborted")), {
				once: true,
			});
		});
	const service = new RatesService(target, {
		storage: new MemoryStorage(),
		fetchImpl,
	});

	const refresh = service.refresh();
	service.dispose();
	await assert.rejects(refresh, /aborted|cancelled/);
	assert.deepEqual(target.applied, []);
});
