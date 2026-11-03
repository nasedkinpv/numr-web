import { expect, test } from "@playwright/test";

test("theme choice applies immediately and persists; system follows the OS", async ({ page }) => {
	await page.route(/^https:\/\//, (route) => route.abort());
	await page.emulateMedia({ colorScheme: "dark" });
	await page.goto("/");
	await expect(page.locator(".cm-editor")).toBeVisible();
	const bg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
	expect(await bg()).toBe("rgb(26, 28, 30)");

	await page.locator("#btn-settings").click();
	await page.getByLabel("Theme").getByText("Light").click();
	await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
	expect(await bg()).toBe("rgb(250, 250, 250)");
	await page.reload();
	await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
	expect(await page.evaluate(() => localStorage.getItem("numr-theme"))).toBe("light");

	await page.locator("#btn-settings").click();
	await page.getByLabel("Theme").getByText("System").click();
	expect(await page.evaluate(() => localStorage.getItem("numr-theme"))).toBe(null);
	await page.emulateMedia({ colorScheme: "light" });
	expect(await bg()).toBe("rgb(250, 250, 250)");
	await page.emulateMedia({ colorScheme: "dark" });
	expect(await bg()).toBe("rgb(26, 28, 30)");
});
