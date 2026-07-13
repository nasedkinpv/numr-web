import { expect, test } from "@playwright/test";

async function blockExternalRequests(page) {
	await page.route(/^https:\/\//, (route) => route.abort());
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
