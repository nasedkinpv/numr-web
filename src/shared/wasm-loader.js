const cache = new Map();

export async function loadNumrWasm({ basePath = "", version = "" } = {}) {
	const isDesktop = location.protocol === "views:";
	const cacheKey = `${basePath}|${version}|${isDesktop}`;
	if (cache.has(cacheKey)) return cache.get(cacheKey);

	const promise = (async () => {
		const versionSuffix = isDesktop || !version ? "" : `?v=${version}`;
		const coreJs = assetUrl("pkg/core/numr_core.js", basePath, versionSuffix);
		const editorJs = assetUrl(
			"pkg/editor/numr_editor.js",
			basePath,
			versionSuffix,
		);

		const [coreModule, editorModule] = await Promise.all([
			import(coreJs),
			import(editorJs),
		]);

		const coreWasmUrl = assetUrl(
			"pkg/core/numr_core_bg.wasm",
			basePath,
			versionSuffix,
		);
		const editorWasmUrl = assetUrl(
			"pkg/editor/numr_editor_bg.wasm",
			basePath,
			versionSuffix,
		);
		const [coreWasm, editorWasm] = isDesktop
			? await Promise.all([
					fetch(coreWasmUrl).then((response) => response.arrayBuffer()),
					fetch(editorWasmUrl).then((response) => response.arrayBuffer()),
				])
			: [coreWasmUrl, editorWasmUrl];

		await Promise.all([
			coreModule.default({ module_or_path: coreWasm }),
			editorModule.default({ module_or_path: editorWasm }),
		]);

		return {
			WasmEngine: coreModule.WasmEngine,
			tokenize: editorModule.tokenize,
		};
	})();

	cache.set(cacheKey, promise);
	return promise;
}

function assetUrl(path, basePath, versionSuffix) {
	if (basePath) return `${basePath.replace(/\/$/, "")}/${path}${versionSuffix}`;
	return new URL(`../../${path}${versionSuffix}`, import.meta.url).href;
}
