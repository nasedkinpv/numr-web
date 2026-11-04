/** Standalone page only: size a fixed shell, never chase native focus panning.
 * interactive-widget=resizes-content handles supporting browsers; VisualViewport
 * supplies the height where the keyboard only resizes the visual viewport.
 * Neither scroll offsets nor pinch zoom may reposition/reflow the shell.
 */
export function manageViewport(window, style, onShrink = () => {}) {
	const viewport = window.visualViewport;
	let frame = null;
	let active = false;
	let previous = null;

	function update() {
		frame = null;
		if (!viewport || viewport.scale !== 1) return;
		const { height } = viewport;
		if (!Number.isFinite(height) || height <= 0 || height === previous) return;
		const shrank = previous !== null && height < previous;
		previous = height;
		style.setProperty("--numr-viewport-height", `${height}px`);
		if (shrank) onShrink();
	}

	function schedule() {
		if (frame === null) frame = window.requestAnimationFrame(update);
	}

	function suspend() {
		active = false;
		viewport?.removeEventListener("resize", schedule);
		window.removeEventListener("resize", schedule);
		if (frame !== null) window.cancelAnimationFrame(frame);
		frame = null;
	}

	function resume() {
		if (active) return;
		active = true;
		viewport?.addEventListener("resize", schedule);
		window.addEventListener("resize", schedule);
		schedule();
	}

	window.addEventListener("pagehide", suspend);
	window.addEventListener("pageshow", resume);
	resume();
	return () => {
		suspend();
		window.removeEventListener("pagehide", suspend);
		window.removeEventListener("pageshow", resume);
		style.removeProperty("--numr-viewport-height");
	};
}
