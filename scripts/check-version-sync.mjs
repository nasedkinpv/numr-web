import { readFile } from "node:fs/promises";

const packageJson = JSON.parse(
	await readFile(new URL("../package.json", import.meta.url), "utf8"),
);
const cargoToml = await readFile(
	new URL("../../Cargo.toml", import.meta.url),
	"utf8",
);
const corePackage = JSON.parse(
	await readFile(new URL("../pkg/core/package.json", import.meta.url), "utf8"),
);
const editorPackage = JSON.parse(
	await readFile(new URL("../pkg/editor/package.json", import.meta.url), "utf8"),
);
const workspacePackage = cargoToml.match(
	/\[workspace\.package\][\s\S]*?^version\s*=\s*"([^"]+)"/m,
);

if (!workspacePackage) {
	throw new Error("Could not read workspace.package.version from ../Cargo.toml");
}

const rustVersion = workspacePackage[1];
if (packageJson.version !== rustVersion) {
	throw new Error(
		`Version mismatch: numr=${rustVersion}, numr-web=${packageJson.version}`,
	);
}


for (const [name, version] of [
	["generated core", corePackage.version],
	["generated editor", editorPackage.version],
]) {
	if (version !== rustVersion) {
		throw new Error(`Version mismatch: numr=${rustVersion}, ${name}=${version}`);
	}
}

console.log(`Version sync OK: ${rustVersion}`);
