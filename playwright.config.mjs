import { defineConfig } from "@playwright/test";

export default defineConfig({
	testDir: "./tests/browser",
	fullyParallel: false,
	workers: 1,
	reporter: "line",
	outputDir: "build/playwright",
	projects: [
		{ name: "chromium", use: { browserName: "chromium" } },
		{ name: "webkit", use: { browserName: "webkit" } },
	],
	use: {
		baseURL: "http://127.0.0.1:4173",
		viewport: { width: 840, height: 640 },
		trace: "retain-on-failure",
	},
	webServer: {
		command: "python3 -m http.server 4173 --bind 127.0.0.1",
		url: "http://127.0.0.1:4173",
		reuseExistingServer: !process.env.CI,
	},
});
