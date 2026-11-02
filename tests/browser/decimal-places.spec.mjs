import { Buffer } from "node:buffer";
import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

const KEY = "numr-decimal-places";

async function precisionControl(page) {
	const control = page.getByRole("spinbutton", { name: "Decimal places" });
	if (!(await control.isVisible())) await page.locator("#btn-settings").click();
	return control;
}

async function blockExternalRequests(page) {
	await page.route(/^https:\/\//, (route) => route.abort());
}

for (const surface of ["web", "desktop"]) {
	test(`${surface} precision updates results/totals without editing a shared document`, async ({ page }) => {
		await blockExternalRequests(page);
		if (surface === "desktop") {
			// Exercise the desktop HTML with the shared bundle, without the native bridge.
			const html = await readFile(new URL("../../desktop/index.html", import.meta.url), "utf8");
			await page.route("http://127.0.0.1:4173/", (route) => route.fulfill({
				contentType: "text/html",
				body: html.replace('<script type="module" src="index.js"></script>', ""),
			}));
		}
		await page.addInitScript(() => {
			localStorage.clear();
			localStorage.setItem("numr-document", "local original");
		});
		const content = "price = $12.34567";
		const hash = `#n1.r.${Buffer.from(content).toString("base64url")}`;
		await page.goto(`/${hash}`);
		await expect(page.locator(".cm-content")).toHaveText(content);
		await expect(page.locator("#totals")).toContainText("$12.35");
		const control = await precisionControl(page);
		await expect(control).toHaveValue("");
		await control.fill("4");
		await expect(page.locator(".numr-result[data-numr-result-anchor]")).toHaveText("$12.3457");
		await expect(page.locator("#totals")).toContainText("$12.3457");
		await expect(page.locator(".cm-content")).toHaveText(content);
		expect(new URL(page.url()).hash).toBe(hash);
		expect(await page.evaluate(() => localStorage.getItem("numr-document"))).toBe("local original");
		expect(await page.evaluate((key) => localStorage.getItem(key), KEY)).toBe("4");
		await control.fill("0");
		await expect(page.locator("#totals")).toContainText("$12");
		await control.fill("");
		await expect(page.locator("#totals")).toContainText("$12.35");
		expect(await page.evaluate((key) => localStorage.getItem(key), KEY)).toBe(null);
	});
}

test("precision persists across reload, including zero and maximum; reset removes the preference", async ({ page }) => {
	await blockExternalRequests(page);
	await page.goto("/");
	await page.locator(".cm-content").fill("1 / 3");
	let control = await precisionControl(page);
	for (const value of ["0", "28"]) {
		await control.fill(value);
		await page.reload();
		control = await precisionControl(page);
		await expect(control).toHaveValue(value);
		await expect(page.locator(".cm-content")).toHaveText("1 / 3");
		await expect(page.locator(".numr-result[data-numr-result-anchor]")).toHaveText(value === "0" ? "0" : `0.${"3".repeat(28)}`);
	}
	await control.fill("");
	await page.reload();
	control = await precisionControl(page);
	await expect(control).toHaveValue("");
	await expect(page.locator(".numr-result[data-numr-result-anchor]")).toHaveText("0.33");
	expect(await page.evaluate((key) => localStorage.getItem(key), KEY)).toBe(null);
});

test("corrupt precision preferences do not break startup or coerce invalid input", async ({ page }) => {
	await blockExternalRequests(page);
	for (const value of ["1.5", "29", "NaN", "-1", "{}"] ) {
		await page.goto("/");
		await page.evaluate(({ key, value }) => {
			localStorage.setItem(key, value);
			localStorage.setItem("numr-document", "$12.34567");
		}, { key: KEY, value });
		await page.reload();
		await expect(await precisionControl(page)).toHaveValue("");
		await expect(page.locator(".numr-result[data-numr-result-anchor]")).toHaveText("$12.35");
	}
});

test("component precision is per instance, validates input, preserves history/selection, and reconnects", async ({ page }) => {
	const errors = [];
	page.on("pageerror", (error) => errors.push(error.message));
	await blockExternalRequests(page);
	await page.goto("/demo.html");
	await page.evaluate(async () => {
		await customElements.whenDefined("numr-calculator");
		localStorage.setItem("numr-decimal-places", "0");
		const create = async (precision) => {
			const element = document.createElement("numr-calculator");
			element.norates = true;
			element.content = "price = $12.34567";
			if (precision !== undefined) element.decimalPlaces = precision;
			const ready = new Promise((resolve) => element.addEventListener("numr-ready", resolve, { once: true }));
			document.body.append(element);
			await ready;
			return element;
		};
		document.body.replaceChildren();
		window.__precise = await create(4);
		window.__auto = await create();
	});
	const precise = page.locator("numr-calculator").nth(0);
	const automatic = page.locator("numr-calculator").nth(1);
	await expect(precise.locator("footer")).toContainText("$12.3457");
	await expect(automatic.locator("footer")).toContainText("$12.35");
	const state = await page.evaluate(() => {
		const calculator = window.__precise;
		const editor = calculator._editor;
		window.__documentChanges = 0;
		const original = editor.onDocumentChange;
		editor.onDocumentChange = (content) => { window.__documentChanges++; original(content); };
		editor.view.dispatch({ changes: { from: editor.view.state.doc.length, insert: "\n1 / 3" }, selection: { anchor: 3 } });
		const selection = editor.view.state.selection.toJSON();
		window.__documentChanges = 0;
		calculator.decimalPlaces = 2;
		const rejected = [];
		for (const value of [1.5, -1, 29, NaN, Infinity, "4", null]) {
			try { calculator.decimalPlaces = value; } catch (error) { rejected.push(error.name); }
		}
		for (const text of ["1.5", "29", "-1", "4px"]) calculator.setAttribute("decimal-places", text);
		return { selection, after: editor.view.state.selection.toJSON(), changes: window.__documentChanges, rejected, precision: calculator.decimalPlaces, content: calculator.getContent() };
	});
	expect(state.after).toEqual(state.selection);
	expect(state.changes).toBe(0);
	expect(state.rejected).toEqual(Array(7).fill("RangeError"));
	expect(state.precision).toBe(2);
	expect(state.content).toBe("price = $12.34567\n1 / 3");
	await precise.locator(".cm-content").focus();
	await page.keyboard.press("ControlOrMeta+z");
	await expect(precise.locator(".cm-content")).toHaveText("price = $12.34567");
	await page.evaluate(async () => {
		const calculator = window.__precise;
		calculator.decimalPlaces = 4;
		calculator.remove();
		const ready = new Promise((resolve) => calculator.addEventListener("numr-ready", resolve, { once: true }));
		document.body.prepend(calculator);
		await ready;
	});
	await expect(precise.locator("footer")).toContainText("$12.3457");
	await page.evaluate(() => { window.__precise.decimalPlaces = undefined; });
	await expect(precise.locator("footer")).toContainText("$12.35");
	expect(await page.evaluate(() => window.__precise.hasAttribute("decimal-places"))).toBe(false);
	expect(await page.evaluate((key) => localStorage.getItem(key), KEY)).toBe("0");
	expect(errors).toEqual([]);
});

test("component KZT totals use the active display precision", async ({ page }) => {
	await blockExternalRequests(page);
	await page.goto("/demo.html");
	await page.evaluate(async () => {
		await customElements.whenDefined("numr-calculator");
		const calculator = document.createElement("numr-calculator");
		calculator.norates = true;
		calculator.content = "100 KZT\n100 tenge\n100 ₸";
		const ready = new Promise((resolve) => calculator.addEventListener("numr-ready", resolve, { once: true }));
		document.body.replaceChildren(calculator);
		await ready;
	});
	const calculator = page.locator("numr-calculator");
	await expect(calculator.locator("footer")).toContainText("300.00₸");
	await calculator.evaluate((element) => { element.decimalPlaces = 0; });
	await expect(calculator.locator("footer")).toContainText("300₸");
	await calculator.evaluate((element) => { element.decimalPlaces = undefined; });
	await expect(calculator.locator("footer")).toContainText("300.00₸");
});
