import { expect, test } from "@playwright/test";

async function blockExternalRequests(page) {
	await page.route(/^https:\/\//, (route) => route.abort());
}

for (const initialPrecision of [4, undefined]) {
	test(`component replays pre-upgrade decimalPlaces=${initialPrecision}`, async ({ page }) => {
		const pageErrors = [];
		page.on("pageerror", (error) => pageErrors.push(error.message));
		await blockExternalRequests(page);
		// A fresh page with no demo/app import: assignment must precede registration.
		await page.route("**/pre-upgrade.html", (route) => route.fulfill({
			contentType: "text/html",
			body: "<!doctype html><body></body>",
		}));
		await page.goto("/pre-upgrade.html");
		const before = await page.evaluate(async (precision) => {
			const registered = Boolean(customElements.get("numr-calculator"));
			const calculator = document.createElement("numr-calculator");
			calculator.setAttribute("content", "1 / 3");
			calculator.setAttribute("norates", "");
			calculator.setAttribute("decimal-places", "6");
			calculator.decimalPlaces = precision;
			const own = Object.hasOwn(calculator, "decimalPlaces");
			const ready = new Promise((resolve) =>
				calculator.addEventListener("numr-ready", resolve, { once: true }),
			);
			document.body.append(calculator);
			window.__numrCalculator = calculator;
			await import("/numr-calculator.js");
			await ready;
			return { registered, own };
		}, initialPrecision);
		expect(before).toEqual({ registered: false, own: true });

		const calculator = page.locator("numr-calculator");
		const result = calculator.locator(".numr-result[data-numr-result-anchor]");
		const initialDisplay = initialPrecision === undefined ? "0.33" : "0.3333";
		await expect(result).toHaveText(initialDisplay);
		expect(await calculator.evaluate((element) => ({
			own: Object.hasOwn(element, "decimalPlaces"),
			precision: element.decimalPlaces,
			attribute: element.getAttribute("decimal-places"),
		}))).toEqual({
			own: false,
			precision: initialPrecision,
			attribute: initialPrecision === undefined ? null : "4",
		});

		await calculator.evaluate((element) => { element.decimalPlaces = 2; });
		await expect(result).toHaveText("0.33");
		await expect(calculator).toHaveAttribute("decimal-places", "2");
		expect(await calculator.evaluate((element) => {
			let rejected;
			try { element.decimalPlaces = 29; } catch (error) { rejected = error.name; }
			return { rejected, precision: element.decimalPlaces, attribute: element.getAttribute("decimal-places") };
		})).toEqual({ rejected: "RangeError", precision: 2, attribute: "2" });
		await expect(result).toHaveText("0.33");

		await calculator.evaluate((element) => { element.decimalPlaces = undefined; });
		expect(await calculator.evaluate((element) => ({
			own: Object.hasOwn(element, "decimalPlaces"),
			precision: element.decimalPlaces,
			attribute: element.getAttribute("decimal-places"),
		}))).toEqual({ own: false, precision: undefined, attribute: null });
		await expect(result).toHaveText("0.33");
		expect(pageErrors).toEqual([]);
	});
}

test("component properties survive initialization and reconnection", async ({
	page,
}) => {
	const pageErrors = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));
	await blockExternalRequests(page);
	await page.goto("/demo.html");

	await page.evaluate(async () => {
		await customElements.whenDefined("numr-calculator");
		localStorage.clear();

		const calculator = document.createElement("numr-calculator");
		calculator.norates = true;
		calculator.setContent("early = 42");
		const ready = new Promise((resolve) =>
			calculator.addEventListener("numr-ready", resolve, { once: true }),
		);
		document.body.replaceChildren(calculator);
		await ready;
		window.__numrCalculator = calculator;
	});

	await expect
		.poll(() =>
			page.evaluate(() => window.__numrCalculator.getContent()),
		)
		.toBe("early = 42");

	await page.evaluate(async () => {
		const previous = window.__numrCalculator;
		previous.remove();

		const calculator = document.createElement("numr-calculator");
		calculator.norates = true;
		calculator.autosave = true;
		calculator.storageKey = "numr-component-lifecycle";
		calculator.wrap = true;
		calculator.readonly = true;
		calculator.clear();
		const ready = new Promise((resolve) =>
			calculator.addEventListener("numr-ready", resolve, { once: true }),
		);
		document.body.append(calculator);
		await ready;
		window.__numrCalculator = calculator;
	});

	const state = await page.evaluate(() => {
		const calculator = window.__numrCalculator;
		const content = calculator.shadowRoot.querySelector(".cm-content");
		return {
			content: calculator.getContent(),
			readOnly: content.getAttribute("contenteditable"),
			wrap: content.classList.contains("cm-lineWrapping"),
		};
	});
	expect(state).toEqual({ content: "", readOnly: "false", wrap: true });

	await page.evaluate(() => {
		const calculator = window.__numrCalculator;
		calculator.readonly = false;
		calculator.setContent("persisted = 9");
	});
	await expect
		.poll(() =>
			page.evaluate(() =>
				localStorage.getItem("numr-component-lifecycle"),
			),
		)
		.toBe("persisted = 9");

	await page.evaluate(async () => {
		const calculator = window.__numrCalculator;
		calculator.remove();
		const ready = new Promise((resolve) =>
			calculator.addEventListener("numr-ready", resolve, { once: true }),
		);
		document.body.append(calculator);
		await ready;
	});
	await expect
		.poll(() =>
			page.evaluate(() => window.__numrCalculator.getContent()),
		)
		.toBe("persisted = 9");

	await page.evaluate(async () => {
		const calculator = window.__numrCalculator;
		const ready = new Promise((resolve) =>
			calculator.addEventListener("numr-ready", resolve, { once: true }),
		);
		calculator.basePath = ".";
		calculator.setContent("changed during restart = 12");
		await ready;
	});
	await expect
		.poll(() =>
			page.evaluate(() => window.__numrCalculator.getContent()),
		)
		.toBe("changed during restart = 12");
	expect(pageErrors).toEqual([]);
});
