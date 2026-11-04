import assert from "node:assert/strict";
import test from "node:test";
import { manageViewport } from "../src/web/viewport.js";

function harness(withViewport = true) {
	const window = new EventTarget();
	window.innerHeight = 800;
	window.scrollY = 0;
	window.visualViewport = withViewport
		? Object.assign(new EventTarget(), { height: 800, offsetTop: 0, scale: 1 }) : undefined;
	const frames = new Map();
	let next = 0;
	window.requestAnimationFrame = (callback) => { frames.set(++next, callback); return next; };
	window.cancelAnimationFrame = (id) => frames.delete(id);
	const values = new Map();
	let writes = 0;
	const style = { setProperty: (k, v) => { writes++; values.set(k, v); }, removeProperty: (k) => values.delete(k) };
	let changes = 0;
	const dispose = manageViewport(window, style, () => changes++);
	return {
		window, viewport: window.visualViewport, frames, values, dispose,
		get changes() { return changes; },
		get writes() { return writes; },
		flush() { const pending = [...frames.values()]; frames.clear(); pending.forEach((fn) => fn()); },
		event(target, name) { target.dispatchEvent(new Event(name)); },
		geometry(height, offsetTop = 0, scale = 1) {
			Object.assign(window.visualViewport, { height, offsetTop, scale });
			window.visualViewport.dispatchEvent(new Event("resize"));
		},
	};
}

// These are synthetic API geometries, not an OS keyboard simulation.
test("an already reduced viewport is used on the first scheduled frame", () => {
	const h = harness();
	h.geometry(420, 60); h.flush();
	assert.equal(h.changes, 0);
	assert.equal(h.values.get("--numr-viewport-height"), "420px");
	assert.equal(h.values.size, 1);
	h.dispose();
});

test("only shrinking height requests editor-local caret correction", () => {
	const h = harness();
	h.flush();
	assert.equal(h.values.get("--numr-viewport-height"), "800px");
	h.geometry(420, 60); h.flush();
	assert.equal(h.values.get("--numr-viewport-height"), "420px");
	assert.equal(h.changes, 1);
	h.geometry(800); h.flush();
	assert.equal(h.values.get("--numr-viewport-height"), "800px");
	assert.equal(h.changes, 1);
	h.dispose();
});

test("native pan and document scroll cannot schedule layout work or caret scrolling", () => {
	const h = harness();
	h.geometry(420, 60); h.flush();
	for (const offset of [100, 200, 50, 0]) {
		h.window.scrollY = offset;
		h.viewport.offsetTop = offset;
		h.event(h.window, "scroll"); h.event(h.viewport, "scroll");
		assert.equal(h.frames.size, 0);
		// Some engines send resize alongside pan despite unchanged height.
		h.event(h.viewport, "resize"); h.flush();
	}
	assert.equal(h.writes, 1);
	assert.equal(h.changes, 0);
	h.dispose(); h.event(h.window, "scroll");
	assert.equal(h.frames.size, 0);
});

test("pinch zoom leaves the last unzoomed layout alone, including pan", () => {
	const h = harness(); h.flush();
	const before = [...h.values];
	for (const scale of [2, 1.1, 0.8]) {
		h.geometry(300, 90, scale); h.event(h.viewport, "scroll"); h.flush();
		assert.deepEqual([...h.values], before);
	}
	assert.equal(h.changes, 0);
	h.geometry(650); h.flush();
	assert.equal(h.values.get("--numr-viewport-height"), "650px");
	h.dispose();
});

test("missing VisualViewport preserves the CSS fallback", () => {
	const h = harness(false); h.flush();
	h.event(h.window, "resize"); h.flush();
	assert.equal(h.values.size, 0);
	assert.equal(h.changes, 0);
	h.dispose();
});

test("events coalesce, unchanged geometry does not write, orientation reads latest layout", () => {
	const h = harness(); h.flush();
	h.geometry(400); h.geometry(450, 20);
	h.event(h.viewport, "scroll"); h.event(h.window, "resize");
	assert.equal(h.frames.size, 1); h.flush();
	assert.equal(h.changes, 1);
	h.event(h.viewport, "scroll"); h.flush();
	assert.equal(h.changes, 1);
	assert.equal(h.writes, 2);
	h.window.innerHeight = 390; h.geometry(300); h.event(h.window, "resize"); h.flush();
	assert.equal(h.values.get("--numr-viewport-height"), "300px");
	h.dispose();
});

test("pagehide cancels work; pageshow resumes once for BFcache; dispose removes everything", () => {
	const h = harness(); h.flush(); h.geometry(400);
	h.event(h.window, "pagehide");
	assert.equal(h.frames.size, 0);
	h.geometry(500); h.event(h.window, "resize");
	assert.equal(h.frames.size, 0);
	h.event(h.window, "pageshow"); h.event(h.window, "pageshow");
	assert.equal(h.frames.size, 1); h.flush();
	assert.equal(h.values.get("--numr-viewport-height"), "500px");
	h.geometry(600); h.dispose();
	assert.equal(h.frames.size, 0); assert.equal(h.values.size, 0);
	h.geometry(700); h.event(h.window, "resize"); h.event(h.window, "pageshow");
	assert.equal(h.frames.size, 0);
});

test("invalid transient geometry is ignored", () => {
	const h = harness(); h.flush();
	for (const [height, top] of [[0, 0], [NaN, 0], [Infinity, 0], [-1, 0]]) {
		h.geometry(height, top); h.flush();
		assert.equal(h.writes, 1);
	}
	h.dispose();
});
