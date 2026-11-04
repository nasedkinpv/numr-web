/** Standalone page only: fit the shell to the unzoomed visible viewport.
 * VisualViewport covers Safari's keyboard overlay/pan; dvh remains the fallback.
 * Never use visual width or follow a pinch-zoomed viewport (ordinary page panning
 * must remain available). No focus heuristic: settings can also open a keyboard.
 */
export function manageViewport(window, style, onResize = () => {}) {
	const viewport = window.visualViewport;
	let frame = null;
	let active = false;
	let previous = "";

	function update() {
		frame = null;
		if (!viewport || viewport.scale !== 1) return;
		const { height, offsetTop } = viewport;
		if (!Number.isFinite(height) || height <= 0 || !Number.isFinite(offsetTop)) return;
		const top = Math.max(0, offsetTop);
		// The absolute shell uses document coordinates; the fixed popover does not.
		const pageTop = top + window.scrollY;
		const bottom = Math.max(0, window.innerHeight - height - top);
		const geometry = `${height}:${pageTop}:${bottom}`;
		if (geometry === previous) return;
		previous = geometry;
		style.setProperty("--numr-viewport-height", `${height}px`);
		style.setProperty("--numr-viewport-top", `${pageTop}px`);
		style.setProperty("--numr-viewport-bottom", `${bottom}px`);
		onResize();
	}

	function schedule() {
		if (frame === null) frame = window.requestAnimationFrame(update);
	}

	function suspend() {
		active = false;
		viewport?.removeEventListener("resize", schedule);
		viewport?.removeEventListener("scroll", schedule);
		window.removeEventListener("resize", schedule);
		window.removeEventListener("scroll", schedule);
		if (frame !== null) window.cancelAnimationFrame(frame);
		frame = null;
	}

	function resume() {
		if (active) return;
		active = true;
		viewport?.addEventListener("resize", schedule);
		viewport?.addEventListener("scroll", schedule);
		window.addEventListener("resize", schedule);
		window.addEventListener("scroll", schedule);
		schedule();
	}

	window.addEventListener("pagehide", suspend);
	window.addEventListener("pageshow", resume);
	resume();
	return () => {
		suspend();
		window.removeEventListener("pagehide", suspend);
		window.removeEventListener("pageshow", resume);
		for (const name of ["height", "top", "bottom"]) {
			style.removeProperty(`--numr-viewport-${name}`);
		}
	};
}
