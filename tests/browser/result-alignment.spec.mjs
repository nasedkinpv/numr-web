import { expect, test } from "@playwright/test";

const EXPRESSION = Array.from({ length: 20 }, (_, index) => index + 1).join(" + ");
const COMMENT =
	"a deliberately long Unicode comment 🧮 that occupies extra visual rows without moving the result anchor";
const DOCUMENT = `${EXPRESSION} // ${COMMENT}`;
const MULTILINE_EXPRESSIONS = [
	Array.from({ length: 24 }, (_, index) => index + 1).join(" + "),
	"1000000 USD in EUR + 25 USD + 30 USD + 40 USD + 50 USD",
	Array.from({ length: 18 }, (_, index) => `${index + 1} km`).join(" + "),
	"median(10, 30, 20, 50, 70, 90, 110, 130, 150, 170)",
	"clamp(120 + 30 + 40 + 50 + 60 + 70 + 80 + 90, 0, 1000)",
];
const MULTILINE_DOCUMENT = MULTILINE_EXPRESSIONS.map(
	(expression) => `${expression} // ${COMMENT}`,
).join("\n");

async function settleLayout(page) {
	await page.evaluate(async () => {
		await document.fonts.ready;
		await new Promise((resolve) =>
			requestAnimationFrame(() => requestAnimationFrame(resolve)),
		);
	});
}

async function readLayout(page) {
	return page.evaluate((expressionLength) => {
		const line = document.querySelector(".cm-content .cm-line");
		const marker = document.querySelector("[data-numr-result-anchor]");
		if (!(line instanceof HTMLElement) || !(marker instanceof HTMLElement)) {
			throw new Error("Editor line or result marker is missing");
		}

		const characterRect = (offset) => {
			const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
			let remaining = offset;
			for (let node = walker.nextNode(); node; node = walker.nextNode()) {
				if (remaining < node.data.length) {
					const range = document.createRange();
					range.setStart(node, remaining);
					range.setEnd(node, remaining + 1);
					return range.getBoundingClientRect();
				}
				remaining -= node.data.length;
			}
			throw new Error(`Text offset ${offset} is outside the editor line`);
		};

		const lineRect = line.getBoundingClientRect();
		const expressionRect = characterRect(expressionLength - 1);
		const commentRect = characterRect(line.textContent.length - 1);
		const markerRect = marker.getBoundingClientRect();
		const lineHeight = Number.parseFloat(getComputedStyle(line).lineHeight);

		return {
			alignmentDelta: markerRect.top - expressionRect.top,
			commentDelta: commentRect.top - markerRect.top,
			expressionRow: Math.round((expressionRect.top - lineRect.top) / lineHeight),
			lineHeight,
			lineRows: Math.round(lineRect.height / lineHeight),
		};
	}, EXPRESSION.length);
}

async function expectAligned(page) {
	await expect
		.poll(async () => {
			await settleLayout(page);
			const layout = await readLayout(page);
			return Math.abs(Math.round(layout.alignmentDelta / layout.lineHeight));
		})
		.toBe(0);
}

async function readAlignmentDeltas(page) {
	return page.evaluate(() => {
		const lines = [...document.querySelectorAll(".cm-content .cm-line")];
		const markers = [
			...document.querySelectorAll("[data-numr-result-anchor]"),
		];
		if (lines.length !== markers.length) {
			throw new Error(
				`Expected one result marker per line, got ${markers.length} for ${lines.length}`,
			);
		}

		return lines.map((line, index) => {
			const prefixLength = line.textContent.indexOf("//") - 1;
			const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
			let remaining = prefixLength - 1;
			for (let node = walker.nextNode(); node; node = walker.nextNode()) {
				if (remaining < node.data.length) {
					const range = document.createRange();
					range.setStart(node, remaining);
					range.setEnd(node, remaining + 1);
					const delta = Math.round(
						markers[index].getBoundingClientRect().top -
							range.getBoundingClientRect().top,
					);
					return delta === 0 ? 0 : delta;
				}
				remaining -= node.data.length;
			}
			throw new Error(`Expression prefix is outside editor line ${index + 1}`);
		});
	});
}

test("results follow the executable row across wrap, resize, and gutter toggles", async ({
	page,
}) => {
	const pageErrors = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));
	await page.route(/^https:\/\//, (route) => route.abort());
	await page.addInitScript((content) => {
		localStorage.clear();
		localStorage.setItem("numr-document", content);
		localStorage.setItem("numr-line-wrapping", "true");
		localStorage.setItem("numr-line-numbers", "true");
	}, DOCUMENT);

	await page.goto("/");
	await expect(page.locator(".cm-editor")).toBeVisible();
	await expect(page.locator("[data-numr-result-anchor]")).toHaveText("210");

	for (const width of [440, 560, 840]) {
		await page.setViewportSize({ width, height: 640 });
		await expectAligned(page);
	}

	await page.setViewportSize({ width: 440, height: 640 });
	await expectAligned(page);
	const wrapped = await readLayout(page);
	expect(wrapped.expressionRow).toBeGreaterThan(0);
	expect(wrapped.commentDelta).toBeGreaterThan(0);
	expect(wrapped.lineRows).toBeGreaterThan(wrapped.expressionRow + 1);

	await page.locator("#btn-settings").click();
	const wrapSwitch = page.locator("#setting-wrap");
	await expect(wrapSwitch).toBeChecked();
	const activeStyle = await wrapSwitch.evaluate((el) => getComputedStyle(el).backgroundColor);
	await wrapSwitch.click();
	await expect(wrapSwitch).not.toBeChecked();
	await page.waitForTimeout(150);
	const inactiveStyle = await wrapSwitch.evaluate((el) => getComputedStyle(el).backgroundColor);
	expect(activeStyle).not.toBe(inactiveStyle);
	await expectAligned(page);
	const unwrapped = await readLayout(page);
	expect(unwrapped.expressionRow).toBe(0);
	expect(unwrapped.lineRows).toBe(1);

	await wrapSwitch.click();
	await expect(wrapSwitch).toBeChecked();
	await expectAligned(page);

	const lineNumbers = page.locator(".numr-line-numbers");
	await expect(lineNumbers).toBeVisible();
	const lineNumbersSwitch = page.locator("#setting-line-numbers");
	await expect(lineNumbersSwitch).toBeChecked();
	await lineNumbersSwitch.click();
	await expect(lineNumbers).toBeHidden();
	await expect(lineNumbersSwitch).not.toBeChecked();
	await expectAligned(page);
	await lineNumbersSwitch.click();
	await expect(lineNumbers).toBeVisible();
	await expectAligned(page);

	expect(pageErrors).toEqual([]);
});

test("line-number toggles keep every wrapped result row aligned", async ({
	page,
}) => {
	await page.route(/^https:\/\//, (route) => route.abort());
	await page.setViewportSize({ width: 440, height: 640 });
	await page.addInitScript((content) => {
		localStorage.clear();
		localStorage.setItem("numr-document", content);
		localStorage.setItem("numr-line-wrapping", "true");
		localStorage.setItem("numr-line-numbers", "true");
	}, MULTILINE_DOCUMENT);

	await page.goto("/");
	await expect(page.locator("[data-numr-result-anchor]")).toHaveCount(
		MULTILINE_EXPRESSIONS.length,
	);
	await settleLayout(page);
	expect(await readAlignmentDeltas(page)).toEqual(
		MULTILINE_EXPRESSIONS.map(() => 0),
	);

	await page.locator("#btn-settings").click();
	const lineNumbersSwitch = page.locator("#setting-line-numbers");
	for (let click = 0; click < 3; click += 1) {
		await lineNumbersSwitch.click();
		await settleLayout(page);
		expect(await readAlignmentDeltas(page)).toEqual(
			MULTILINE_EXPRESSIONS.map(() => 0),
		);
	}
});
