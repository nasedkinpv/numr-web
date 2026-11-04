import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

async function start(page) {
	await page.route(/^https:\/\//, (route) => route.abort());
	await page.goto("/");
	await page.evaluate(() => window.numrReady);
}

async function shellBounds(page, top, height) {
	await expect.poll(() => page.locator(".container").evaluate((el) => {
		const r = el.getBoundingClientRect(); return [r.top, r.height];
	})).toEqual([top, height]);
	const footer = await page.locator("footer").boundingBox();
	expect(footer.y + footer.height).toBeCloseTo(top + height, 0);
	const scroll = await page.locator(".cm-scroller").boundingBox();
	expect(scroll.height).toBeGreaterThan(0);
	expect(scroll.y + scroll.height).toBeLessThanOrEqual(footer.y + 1);
}

async function geometry(page, height, offsetTop = 0, scale = 1) {
	await page.evaluate(({ height, offsetTop, scale }) => {
		Object.assign(window.visualViewport, { height, offsetTop, scale });
		window.visualViewport.dispatchEvent(new Event("resize"));
		window.visualViewport.dispatchEvent(new Event("scroll"));
	}, { height, offsetTop, scale });
}

test("desktop keeps compact font, startup focus, and native viewport ownership", async ({ page }) => {
	await start(page);
	await expect(page.locator(".cm-content")).toBeFocused();
	await expect(page.locator(".cm-editor")).toHaveCSS("font-size", "14px");
	// The real desktop entrypoint imports the same web app but does not opt in.
	const html = await readFile(new URL("../../desktop/index.html", import.meta.url), "utf8");
	await page.route("http://127.0.0.1:4173/", (route) => route.fulfill({
		contentType: "text/html", body: html.replace('<script type="module" src="index.js"></script>', ""),
	}));
	await page.goto("/"); await page.evaluate(() => window.numrReady);
	expect(await page.evaluate(() => document.documentElement.style.getPropertyValue("--numr-viewport-height"))).toBe("");
	await expect(page.locator(".cm-editor")).toHaveCSS("font-size", "14px");
});

test.describe("touch text entry", () => {
	test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

	test("fonts, gutters, settings and controls fit without startup focus or horizontal page overflow", async ({ page }) => {
		await start(page);
		await expect(page.locator(".cm-content")).not.toBeFocused();
		await page.locator(".cm-content").tap();
		await expect(page.locator(".cm-content")).toBeFocused();
		for (const selector of [".cm-content", ".cm-gutters", ".numr-results", ".numr-line-numbers"]) {
			await expect(page.locator(selector).first()).toHaveCSS("font-size", "16px");
		}
		const metrics = await page.locator(".cm-scroller, .cm-gutterElement").evaluateAll((els) => els.map((el) => getComputedStyle(el).lineHeight));
		expect(new Set(metrics)).toEqual(new Set(["24px"]));
		await page.locator("#btn-settings").tap();
		await expect(page.locator("#decimal-places")).toHaveCSS("font-size", "16px");
		await page.locator("#decimal-places").tap();
		await expect(page.locator("#decimal-places")).toBeFocused();
		for (const selector of ["#settings", "#decimal-places", "#btn-settings", "#btn-new", "#btn-load", "#totals"]) {
			const box = await page.locator(selector).boundingBox();
			expect(box.x).toBeGreaterThanOrEqual(0);
			expect(box.x + box.width).toBeLessThanOrEqual(391);
			expect(box.y + box.height).toBeLessThanOrEqual(844);
		}
		expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
		const meta = await page.locator('meta[name="viewport"]').getAttribute("content");
		expect(meta).toContain("interactive-widget=resizes-content");
		expect(meta).not.toMatch(/user-scalable|maximum-scale/);
	});

	test("synthetic keyboard geometry fits shell/popover and preserves editing history, selection and persistence", async ({ page }) => {
		// EventTarget API harness only: emulation does not open an OS keyboard or
		// reproduce Safari's focus zoom. Exercise the actual bundled controller.
		await page.addInitScript(() => {
			Object.defineProperty(window, "visualViewport", { configurable: true,
				value: Object.assign(new EventTarget(), { height: 844, offsetTop: 0, scale: 1 }) });
		});
		await start(page); await shellBounds(page, 0, 844);
		const editor = page.locator(".cm-content");
		await editor.fill("1 + 2");
		// Separate native typing into its own CodeMirror history group.
		await page.waitForTimeout(600);
		await page.keyboard.press("End"); await page.keyboard.type(" + 4");
		await expect(editor).toHaveText("1 + 2 + 4");
		const selection = await page.evaluate(() => getSelection().focusOffset);
		await geometry(page, 390, 45); await shellBounds(page, 45, 390);
		expect(await page.evaluate(() => getSelection().focusOffset)).toBe(selection);
		await expect(editor).toHaveText("1 + 2 + 4");
		await page.keyboard.press("ControlOrMeta+z"); await expect(editor).toHaveText("1 + 2");
		await page.locator("#btn-settings").tap();
		await page.locator("#decimal-places").fill("3");
		await geometry(page, 310, 70); await shellBounds(page, 70, 310);
		let panel = await page.locator("#settings").boundingBox();
		expect(panel.y).toBeGreaterThanOrEqual(70);
		expect(panel.y + panel.height).toBeLessThanOrEqual(380);
		await geometry(page, 160, 30); await shellBounds(page, 30, 160);
		panel = await page.locator("#settings").boundingBox();
		expect(panel.y).toBeGreaterThanOrEqual(30);
		expect(await page.locator("#settings").evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
		await page.locator("#decimal-places").scrollIntoViewIfNeeded();
		await expect(page.locator("#decimal-places")).toBeInViewport();
		await geometry(page, 80, 90, 2);
		await page.waitForTimeout(60); await shellBounds(page, 30, 160);
		expect(await page.locator(".container").evaluate((el) => el.getBoundingClientRect().width)).toBe(390);
		await geometry(page, 844); await shellBounds(page, 0, 844);
		// BFcache restores the same app instance: its viewport listeners resume.
		await page.evaluate(() => dispatchEvent(new Event("pagehide")));
		await geometry(page, 500, 10);
		await page.evaluate(() => dispatchEvent(new Event("pageshow")));
		await shellBounds(page, 10, 500);
		await geometry(page, 844); await shellBounds(page, 0, 844);
		await expect.poll(() => page.evaluate(() => localStorage.getItem("numr-document"))).toBe("1 + 2");
		await page.reload(); await page.evaluate(() => window.numrReady);
		await expect(editor).toHaveText("1 + 2");
		await page.locator("#btn-settings").tap(); await expect(page.locator("#decimal-places")).toHaveValue("3");
	});

	test("layout scrolling does not displace the shell from the synthetic visual viewport", async ({ page }) => {
		await page.addInitScript(() => {
			Object.defineProperty(window, "visualViewport", { configurable: true,
				value: Object.assign(new EventTarget(), { height: 844, offsetTop: 0, scale: 1 }) });
		});
		await start(page);
		await geometry(page, 320, 40); await shellBounds(page, 40, 320);
		// Exercise real document scrolling as well as synthetic keyboard geometry.
		await page.evaluate(() => {
			document.documentElement.style.height = "1800px";
			window.scrollTo(0, 100);
		});
		await expect.poll(() => page.evaluate(() => scrollY)).toBe(100);
		await shellBounds(page, 40, 320);
		await page.locator("#btn-settings").tap();
		const panel = await page.locator("#settings").boundingBox();
		expect(panel.y).toBeGreaterThanOrEqual(40);
		expect(panel.y + panel.height).toBeLessThanOrEqual(360);
	});

	test("caret stays in the editor scroll area after synthetic keyboard shrink", async ({ page }) => {
		await page.addInitScript(() => {
			Object.defineProperty(window, "visualViewport", { configurable: true,
				value: Object.assign(new EventTarget(), { height: 844, offsetTop: 0, scale: 1 }) });
		});
		await start(page);
		await page.locator(".cm-content").fill(Array.from({ length: 60 }, (_, i) => `${i} + 1`).join("\n"));
		await page.keyboard.press("ControlOrMeta+End");
		await geometry(page, 320, 40); await shellBounds(page, 40, 320);
		await expect.poll(() => page.evaluate(() => {
			const selection = getSelection();
			if (!selection.rangeCount) return false;
			const caret = selection.getRangeAt(0).getBoundingClientRect();
			const scroll = document.querySelector(".cm-scroller").getBoundingClientRect();
			return caret.top >= scroll.top && caret.bottom <= scroll.bottom;
		})).toBe(true);
	});

	test("narrow and landscape layouts keep controls and settings inside the page", async ({ page }) => {
		await start(page);
		for (const viewport of [{ width: 320, height: 568 }, { width: 844, height: 390 }]) {
			await page.setViewportSize(viewport);
			await shellBounds(page, 0, viewport.height);
			if (!(await page.locator("#settings").isVisible())) await page.locator("#btn-settings").tap();
			for (const selector of ["#settings", "#btn-settings", "#decimal-places", "header"]) {
				const box = await page.locator(selector).boundingBox();
				expect(box.x).toBeGreaterThanOrEqual(0);
				expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
				expect(box.y).toBeGreaterThanOrEqual(0);
				expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
			}
			await expect(page.locator(".cm-content")).toHaveCSS("font-size", "16px");
			expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
		}
	});

	test("embedded component uses safe text metrics without managing host viewport", async ({ page }) => {
		await page.route(/^https:\/\//, (route) => route.abort());
		await page.goto("/demo.html");
		const component = page.locator("numr-calculator").first();
		await expect(component.locator(".cm-content")).toBeVisible();
		await expect(component.locator(".cm-content")).toHaveCSS("font-size", "16px");
		expect(await page.evaluate(() => document.documentElement.style.getPropertyValue("--numr-viewport-height"))).toBe("");
	});
});
