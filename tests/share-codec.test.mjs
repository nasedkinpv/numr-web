import assert from "node:assert/strict";
import test from "node:test";

import {
	decodeContentFromHash,
	encodeContentForHash,
	parseShareHash,
} from "../src/shared/share-codec.js";

test("raw share links round-trip Unicode content", async () => {
	const content = "Привет, numr!\n100 USD in EUR";
	const hash = encodeContentForHash(content);
	const parsed = parseShareHash(`#${hash}`);
	assert.deepEqual(parsed?.mode, "r");
	assert.equal(
		await decodeContentFromHash(parsed.mode, parsed.payload),
		content,
	);
});

test("compressed links emitted by older releases remain readable", async () => {
	const payload =
		"eJy7MP9iw4UdFzZd2HqxSUchrzS3SJHL0MBAITTYRSEzT8E1NAidCwA-LxIw";
	const parsed = parseShareHash(`#n1.z.${payload}`);
	assert.equal(
		await decodeContentFromHash(parsed.mode, parsed.payload),
		"Привет, numr!\n100 USD in EUR\n100 USD in EUR\n",
	);
});

test("unknown share formats are ignored", () => {
	assert.equal(parseShareHash("#n2.r.payload"), null);
	assert.equal(parseShareHash("#n1.x.payload"), null);
});
