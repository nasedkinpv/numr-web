export const DEFAULT_FIAT_RATES_URL =
	"https://open.er-api.com/v6/latest/USD";
export const DEFAULT_CRYPTO_RATES_URL =
	"https://api.coingecko.com/api/v3/simple/price";

const DEFAULT_CACHE_TTL_MS = 60 * 60 * 1000;
const DEFAULT_RATES_KEY = "numr-rates";
const DEFAULT_TIMESTAMP_KEY = "numr-rates-timestamp";

// Compatibility fallback for older WASM packages. In 0.7 the registry is
// exported by numr-core and takes precedence over this list.
export const FALLBACK_CRYPTO_CURRENCIES = [
	["BTC", "bitcoin"],
	["ETH", "ethereum"],
	["SOL", "solana"],
	["USDT", "tether"],
	["USDC", "usd-coin"],
	["BNB", "binancecoin"],
	["XRP", "ripple"],
	["ADA", "cardano"],
	["DOGE", "dogecoin"],
	["DOT", "polkadot"],
	["LTC", "litecoin"],
	["LINK", "chainlink"],
	["AVAX", "avalanche-2"],
	["MATIC", "polygon-ecosystem-token"],
	["TON", "the-open-network"],
];

export class RatesService {
	constructor(
		session,
		{
			storage = globalThis.localStorage,
			fetchImpl = globalThis.fetch?.bind(globalThis),
			now = () => Date.now(),
			cacheTtlMs = DEFAULT_CACHE_TTL_MS,
			fiatUrl = DEFAULT_FIAT_RATES_URL,
			cryptoUrl = DEFAULT_CRYPTO_RATES_URL,
			requestTimeoutMs = 10_000,
		} = {},
	) {
		this.session = session;
		this.storage = storage;
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
		if (!this.storage) return null;
		const rawTimestamp = this.storage.getItem(DEFAULT_TIMESTAMP_KEY);
		if (!rawTimestamp) return null;
		const timestamp = Number(rawTimestamp);
		const age = this.now() - timestamp;
		if (!Number.isFinite(timestamp) || age < 0 || age >= this.cacheTtlMs) {
			return null;
		}

		try {
			const rates = JSON.parse(this.storage.getItem(DEFAULT_RATES_KEY) || "null");
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
		const cached = this.loadCached();
		return cached
			? { status: "success", source: "cache", ...cached }
			: this.refresh();
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
		const fromCore = this.session.getCryptoCurrencies?.() || [];
		if (fromCore.length) {
			return fromCore.map(({ code, coingecko_id: id }) => [code, id]);
		}
		return FALLBACK_CRYPTO_CURRENCIES;
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

	#store(rates, timestamp) {
		if (!this.storage) return;
		try {
			this.storage.setItem(DEFAULT_RATES_KEY, JSON.stringify(rates));
			this.storage.setItem(DEFAULT_TIMESTAMP_KEY, String(timestamp));
		} catch {
			// Cache persistence is best-effort; fresh rates are already applied.
		}
	}
}
