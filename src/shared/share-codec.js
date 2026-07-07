const SHARE_HASH_PATTERN = /^n1\.(r|z)\.([A-Za-z0-9_-]+)$/;
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export function parseShareHash(hash) {
	if (!hash) return null;
	const value = hash.startsWith("#") ? hash.slice(1) : hash;
	const match = SHARE_HASH_PATTERN.exec(value);
	if (!match) return null;
	return { mode: match[1], payload: match[2] };
}

export function encodeContentForHash(content) {
	return `n1.r.${toBase64Url(textEncoder.encode(content))}`;
}

export async function decodeContentFromHash(mode, payload) {
	const bytes = fromBase64Url(payload);

	if (mode === "r") return textDecoder.decode(bytes);

	if (mode === "z") {
		const decompressedBytes = await decompressBytes(bytes);
		if (!decompressedBytes) {
			throw new Error(
				"Compressed share links are not supported in this browser",
			);
		}
		return textDecoder.decode(decompressedBytes);
	}

	throw new Error(`Unsupported share format: ${mode}`);
}

export function toBase64Url(bytes) {
	const chunkSize = 0x8000;
	let binary = "";

	for (let i = 0; i < bytes.length; i += chunkSize) {
		binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
	}

	return btoa(binary)
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/g, "");
}

export function fromBase64Url(base64url) {
	const normalized = base64url.replace(/-/g, "+").replace(/_/g, "/");
	const padding =
		normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
	const binary = atob(normalized + padding);
	const bytes = new Uint8Array(binary.length);

	for (let i = 0; i < binary.length; i++) {
		bytes[i] = binary.charCodeAt(i);
	}

	return bytes;
}

async function decompressBytes(bytes) {
	if (typeof DecompressionStream !== "function") return null;

	try {
		const stream = new DecompressionStream("deflate");
		const writer = stream.writable.getWriter();
		await writer.write(bytes);
		await writer.close();
		const buffer = await new Response(stream.readable).arrayBuffer();
		return new Uint8Array(buffer);
	} catch {
		throw new Error("Share link payload is corrupted");
	}
}
