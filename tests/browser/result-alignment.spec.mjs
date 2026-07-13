import { expect, test } from "@playwright/test";

const EXPRESSION = Array.from({ length: 20 }, (_, index) => index + 1).join(" + ");
const COMMENT =
	"a deliberately long Unicode comment 🧮 that occupies extra visual rows without moving the result anchor";
const DOCUMENT = `${EXPRESSION} // ${COMMENT}`;

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

	const wrapButton = page.locator("#btn-wrap");
	await expect(wrapButton).toHaveAccessibleName("Disable line wrapping");
	await page.locator(".cm-content").hover();
	const activeStyle = await wrapButton.evaluate((button) => {
		const style = getComputedStyle(button);
		return { color: style.color, background: style.backgroundColor };
	});
	await wrapButton.click();
	await expect(wrapButton).toHaveAttribute("aria-pressed", "false");
	await expect(wrapButton).toHaveAccessibleName("Wrap long lines");
	await page.waitForTimeout(150);
	const hoverStyle = await wrapButton.evaluate((button) => {
		const style = getComputedStyle(button);
		return { color: style.color, background: style.backgroundColor };
	});
	await page.locator(".cm-content").hover();
	const inactiveStyle = await wrapButton.evaluate((button) => {
		const style = getComputedStyle(button);
		return { color: style.color, background: style.backgroundColor };
	});
	expect(activeStyle.background).not.toBe(inactiveStyle.background);
	expect(hoverStyle.color).not.toBe(inactiveStyle.color);
	expect(hoverStyle).not.toEqual(activeStyle);
	await expectAligned(page);
	const unwrapped = await readLayout(page);
	expect(unwrapped.expressionRow).toBe(0);
	expect(unwrapped.lineRows).toBe(1);

	await wrapButton.click();
	await expect(wrapButton).toHaveAccessibleName("Disable line wrapping");
	await expectAligned(page);

	await expect(page.locator(".numr-line-numbers")).toHaveCount(1);
	const lineNumbersButton = page.locator("#btn-line-numbers");
	await expect(lineNumbersButton).toHaveAccessibleName("Hide line numbers");
	await lineNumbersButton.click();
	await expect(page.locator(".numr-line-numbers")).toHaveCount(0);
	await expect(lineNumbersButton).toHaveAccessibleName("Show line numbers");
	await expectAligned(page);
	await lineNumbersButton.click();
	await expect(page.locator(".numr-line-numbers")).toHaveCount(1);
	await expectAligned(page);

	expect(pageErrors).toEqual([]);
});
