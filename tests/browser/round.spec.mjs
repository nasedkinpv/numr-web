import { expect, test } from "@playwright/test";

test("component evaluates stored rounding, ties, and invalid precision through real WASM", async ({ page }) => {
	await page.route(/^https:\/\//, (route) => route.abort());
	await page.goto("/demo.html");
	const content = [
		"rounded = round(1.234567, 4)",
		"rounded * 10000",
		"round(1.245, 2)",
		"round(1.255, 2)",
		"round(-1.245, 2)",
		"round(-1.255, 2)",
		"round(2.5, 0)",
		"round(3.5, 0)",
		"round(1.23, -1)",
		"round(1.23, 1.5)",
		"round(1.23, 29)",
	].join("\n");
	await page.evaluate(async (content) => {
		await customElements.whenDefined("numr-calculator");
		const calculator = document.createElement("numr-calculator");
		calculator.norates = true;
		calculator.decimalPlaces = 4;
		calculator.content = content;
		const ready = new Promise((resolve) => calculator.addEventListener("numr-ready", resolve, { once: true }));
		document.body.replaceChildren(calculator);
		await ready;
	}, content);
	const calculator = page.locator("numr-calculator");
	const results = calculator.locator(".numr-result[data-numr-result-anchor]");
	const error = "Error: round precision must be an integer between 0 and 28";
	await expect(results).toHaveText([
		"1.2346", "12346", "1.2400", "1.2600", "-1.2400", "-1.2600", "2", "4",
	]);
	const errors = calculator.locator(".numr-error-bullet");
	await expect(errors).toHaveCount(3);
	for (const bullet of await errors.all()) {
		await expect(bullet.locator("..")).toHaveAttribute("title", error);
	}
	await calculator.evaluate((element) => { element.decimalPlaces = 2; });
	await expect(results.nth(0)).toHaveText("1.23");
	await expect(results.nth(1)).toHaveText("12346");
	expect(await calculator.evaluate((element) => element.getContent())).toBe(content);
});
