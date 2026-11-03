import { createSafeStorage, STORAGE_KEYS } from "./storage.js";

export const DEFAULT_FIAT_RATES_URL =
	"https://open.er-api.com/v6/latest/USD";
export const DEFAULT_CRYPTO_RATES_URL =
	"https://api.coingecko.com/api/v3/simple/price";

const DEFAULT_CACHE_TTL_MS = 60 * 60 * 1000;

export class RatesService {
	constructor(
		session,
		{
			storage,
			fetchImpl = globalThis.fetch?.bind(globalThis),
			now = () => Date.now(),
			cacheTtlMs = DEFAULT_CACHE_TTL_MS,
			fiatUrl = DEFAULT_FIAT_RATES_URL,
			cryptoUrl = DEFAULT_CRYPTO_RATES_URL,
			requestTimeoutMs = 10_000,
			store = null,
		} = {},
	) {
		this.session = session;
		this.storage = createSafeStorage(storage);
		// Optional host-side cache shared with other numr frontends:
		// { load(): Promise<{ rates, timestamp } | null>, save(rates, timestamp) }.
		this.store = store;
		this.fetchImpl = fetchImpl;
		this.now = now;
		this.cacheTtlMs = cacheTtlMs;
		this.fiatUrl = fiatUrl;
		this.cryptoUrl = cryptoUrl;
		this.requestTimeoutMs = requestTimeoutMs;
		this.inFlight = null;
		this.controllers = new Set();
		this.disposed = false;
	}

	loadCached() {
		const rawTimestamp = this.storage.getItem(STORAGE_KEYS.ratesTimestamp);
		if (!rawTimestamp) return null;
		const timestamp = Number(rawTimestamp);
		const age = this.now() - timestamp;
		if (!Number.isFinite(timestamp) || age < 0 || age >= this.cacheTtlMs) {
			return null;
		}

		try {
			const rates = JSON.parse(
				this.storage.getItem(STORAGE_KEYS.rates) || "null",
			);
			if (!rates || typeof rates !== "object" || !Object.keys(rates).length) {
				return null;
			}
			this.session.applyRates(rates);
			return { rates, timestamp };
		} catch {
			return null;
		}
	}

	async initialize() {
		if (this.disposed) throw new Error("Rates service has been disposed");
		const cached = this.loadCached() ?? (await this.#loadStore());
		return cached
			? { status: "success", source: "cache", ...cached }
			: this.refresh();
	}

	async #loadStore() {
		if (!this.store?.load) return null;
		try {
			const entry = await this.store.load();
			const rates = entry?.rates;
			const timestamp = Number(entry?.timestamp);
			const age = this.now() - timestamp;
			if (
				!rates ||
				typeof rates !== "object" ||
				!Object.keys(rates).length ||
				!Number.isFinite(timestamp) ||
				age < 0 ||
				age >= this.cacheTtlMs
			) {
				return null;
			}
			if (this.disposed) return null;
			this.session.applyRates(rates);
			this.#store(rates, timestamp, { share: false });
			return { rates, timestamp };
		} catch {
			return null;
		}
	}

	refresh() {
		if (this.disposed) {
			return Promise.reject(new Error("Rates service has been disposed"));
		}
		if (this.inFlight) return this.inFlight;
		this.inFlight = this.#refresh().finally(() => {
			this.inFlight = null;
		});
		return this.inFlight;
	}

	async #refresh() {
		if (!this.fetchImpl) throw new Error("Fetch API is unavailable");

		const cryptoCurrencies = this.#cryptoCurrencies();
		const [fiatResult, cryptoResult] = await Promise.allSettled([
			this.#fetchFiat(),
			this.#fetchCrypto(cryptoCurrencies),
		]);
		const fiat = fiatResult.status === "fulfilled" ? fiatResult.value : {};
		const crypto =
			cryptoResult.status === "fulfilled" ? cryptoResult.value : {};
		const rates = { ...fiat, ...crypto };
		if (this.disposed) {
			throw new Error("Rates refresh was cancelled");
		}
		if (!Object.keys(rates).length) {
			const failure = [fiatResult, cryptoResult].find(
				(result) => result.status === "rejected",
			);
			if (failure) throw failure.reason;
			throw new Error("Rate providers returned no usable rates");
		}

		this.session.applyRates(rates);
		const timestamp = this.now();
		this.#store(rates, timestamp);
		return {
			status: "success",
			source: "network",
			rates,
			timestamp,
			warning:
				fiatResult.status === "rejected" || cryptoResult.status === "rejected",
		};
	}

	#cryptoCurrencies() {
		return this.session
			.getCryptoCurrencies()
			.map(({ code, coingecko_id: id }) => [code, id]);
	}

	async #fetchFiat() {
		const data = await this.#fetchJson(this.fiatUrl);
		return data.rates && typeof data.rates === "object" ? data.rates : {};
	}

	async #fetchCrypto(currencies) {
		if (!currencies.length) return {};
		const url = new URL(this.cryptoUrl);
		url.searchParams.set("ids", currencies.map(([, id]) => id).join(","));
		url.searchParams.set("vs_currencies", "usd");
		const data = await this.#fetchJson(url);
		return Object.fromEntries(
			currencies.flatMap(([code, id]) =>
				Number.isFinite(data[id]?.usd) ? [[code, data[id].usd]] : [],
			),
		);
	}

	async #fetchJson(url) {
		const controller = new AbortController();
		this.controllers.add(controller);
		const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs);
		try {
			const response = await this.fetchImpl(url, { signal: controller.signal });
			if (!response.ok) {
				throw new Error(`Rate provider returned HTTP ${response.status}`);
			}
			return response.json();
		} finally {
			clearTimeout(timeout);
			this.controllers.delete(controller);
		}
	}

	dispose() {
		this.disposed = true;
		for (const controller of this.controllers) controller.abort();
		this.controllers.clear();
	}

	#store(rates, timestamp, { share = true } = {}) {
		this.storage.setItem(STORAGE_KEYS.rates, JSON.stringify(rates));
		this.storage.setItem(STORAGE_KEYS.ratesTimestamp, timestamp);
		if (share && this.store?.save) {
			Promise.resolve()
				.then(() => this.store.save(rates, timestamp))
				.catch((error) => console.warn("Failed to share rates:", error));
		}
	}
}
