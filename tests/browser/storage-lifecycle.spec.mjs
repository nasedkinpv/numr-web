import { Buffer } from "node:buffer";

import { expect, test } from "@playwright/test";

const DOCUMENT_KEY = "numr-document";
const WRAP_KEY = "numr-line-wrapping";
const LINE_NUMBERS_KEY = "numr-line-numbers";

function shareHash(content) {
	return `#n1.r.${Buffer.from(content).toString("base64url")}`;
}

async function blockExternalRequests(page) {
	await page.route(/^https:\/\//, (route) => route.abort());
}

async function setDocument(page, content) {
	const editor = page.locator(".cm-content");
	await editor.fill(content);
	await expect(editor).toHaveText(content);
}

async function stored(page, key) {
	return page.evaluate((storageKey) => localStorage.getItem(storageKey), key);
}

test("document, empty state, unload, and view settings survive reload", async ({
	page,
}) => {
	await blockExternalRequests(page);
	await page.addInitScript(() => {
		if (sessionStorage.getItem("numr-storage-test-ready")) return;
		localStorage.clear();
		sessionStorage.setItem("numr-storage-test-ready", "true");
	});
	await page.goto("/");
	await expect(page.locator(".cm-editor")).toBeVisible();

	await setDocument(page, "persisted = 42");
	await expect.poll(() => stored(page, DOCUMENT_KEY)).toBe("persisted = 42");
	await page.reload();
	await expect(page.locator(".cm-content")).toHaveText("persisted = 42");

	await page.locator("#btn-line-numbers").click();
	await page.locator("#btn-wrap").click();
	await expect.poll(() => stored(page, LINE_NUMBERS_KEY)).toBe("false");
	await expect.poll(() => stored(page, WRAP_KEY)).toBe("false");
	await page.reload();
	await expect(page.locator("#btn-line-numbers")).toHaveAttribute(
		"aria-pressed",
		"false",
	);
	await expect(page.locator("#btn-wrap")).toHaveAttribute("aria-pressed", "false");

	await setDocument(page, "immediate reload");
	await page.reload();
	await expect(page.locator(".cm-content")).toHaveText("immediate reload");

	await setDocument(page, "");
	await expect.poll(() => stored(page, DOCUMENT_KEY)).toBe("");
	await page.reload();
	await expect(page.locator(".cm-content")).toHaveText("");
});

test("shared content stays isolated until the user edits it", async ({ page }) => {
	const localContent = "local_original = 7";
	const sharedContent = "shared_payload = 9";
	const editedContent = "edited_after_share = 11";

	await blockExternalRequests(page);
	await page.addInitScript(
		({ key, content }) => {
			if (sessionStorage.getItem("numr-share-test-ready")) return;
			localStorage.setItem(key, content);
			sessionStorage.setItem("numr-share-test-ready", "true");
		},
		{ key: DOCUMENT_KEY, content: localContent },
	);
	await page.goto(`/${shareHash(sharedContent)}`);
	await expect(page.locator(".cm-content")).toHaveText(sharedContent);

	await page.waitForTimeout(350);
	expect(await stored(page, DOCUMENT_KEY)).toBe(localContent);

	await setDocument(page, editedContent);
	await expect.poll(() => stored(page, DOCUMENT_KEY)).toBe(editedContent);
	await expect(page).toHaveURL("http://127.0.0.1:4173/");
	await page.reload();
	await expect(page.locator(".cm-content")).toHaveText(editedContent);
});

test("creating a share link does not turn the working URL into a snapshot", async ({
	page,
}) => {
	await blockExternalRequests(page);
	await page.addInitScript(() => {
		Object.defineProperty(navigator, "share", {
			configurable: true,
			value: async ({ url }) => {
				window.__numrSharedUrl = url;
			},
		});
	});
	await page.goto("/");
	await setDocument(page, "share_current = 17");
	await page.locator("#btn-share").click();

	await expect(page).toHaveURL("http://127.0.0.1:4173/");
	const sharedUrl = await page.evaluate(() => window.__numrSharedUrl);
	expect(sharedUrl).toMatch(/^http:\/\/127\.0\.0\.1:4173\/#n1\.r\./);
});

test("blocked Web Storage does not prevent startup", async ({ page }) => {
	const pageErrors = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));
	await blockExternalRequests(page);
	await page.addInitScript(() => {
		for (const method of ["getItem", "setItem"]) {
			Object.defineProperty(Storage.prototype, method, {
				configurable: true,
				value() {
					throw new DOMException("storage blocked", "SecurityError");
				},
			});
		}
	});

	await page.goto("/");
	await expect(page.locator(".cm-editor")).toBeVisible();
	expect(pageErrors).toEqual([]);
});
