import {
	Compartment,
	EditorState,
	StateEffect,
	StateField,
} from "@codemirror/state";
import {
	Decoration,
	EditorView,
	GutterMarker,
	ViewPlugin,
	gutter,
	gutters,
	keymap,
} from "@codemirror/view";
import {
	history,
	historyKeymap,
	insertNewline,
	standardKeymap,
} from "@codemirror/commands";

import {
	appendTokenNodes,
	tokenRanges,
} from "./token-view.js";

const EMPTY_EVALUATION = Object.freeze({ results: [], totals: [] });
const setEvaluation = StateEffect.define();
const evaluationField = StateField.define({
	create: () => EMPTY_EVALUATION,
	update(value, transaction) {
		for (const effect of transaction.effects) {
			if (effect.is(setEvaluation)) return effect.value;
		}
		return value;
	},
});

class LineNumberMarker extends GutterMarker {
	constructor(number, error = "") {
		super();
		this.number = number;
		this.error = error;
	}

	eq(other) {
		return this.number === other.number && this.error === other.error;
	}

	toDOM() {
		const marker = document.createElement("span");
		marker.className = this.error
			? "numr-line-number numr-line-number-error"
			: "numr-line-number";
		if (this.error) {
			marker.title = this.error;
			const bullet = document.createElement("span");
			bullet.className = "numr-error-bullet";
			bullet.setAttribute("aria-hidden", "true");
			marker.append(bullet);
		}
		marker.append(document.createTextNode(String(this.number)));
		return marker;
	}
}

class ResultMarker extends GutterMarker {
	constructor(session, text = "", anchor = null) {
		super();
		this.session = session;
		this.text = text;
		this.anchor = anchor;
	}

	eq(other) {
		return this.text === other.text && this.anchor === other.anchor;
	}

	toDOM() {
		const marker = document.createElement("span");
		marker.className = "numr-result";
		if (this.anchor !== null) {
			marker.dataset.numrResultAnchor = String(this.anchor);
		}
		appendTokenNodes(marker, this.session, this.text);
		return marker;
	}
}

function evaluationChanged(update) {
	return (
		update.docChanged ||
		update.startState.field(evaluationField) !==
			update.state.field(evaluationField)
	);
}

function lineNumbersGutter() {
	return gutter({
		class: "numr-line-numbers",
		renderEmptyElements: true,
		lineMarker(view, block) {
			const line = view.state.doc.lineAt(block.from);
			const result = view.state.field(evaluationField).results[line.number - 1];
			return new LineNumberMarker(
				line.number,
				result?.is_error ? result.result : "",
			);
		},
		lineMarkerChange: evaluationChanged,
		initialSpacer: (view) => new LineNumberMarker(view.state.doc.lines),
		updateSpacer: (_spacer, update) =>
			new LineNumberMarker(update.state.doc.lines),
	});
}

const hiddenLineNumbersTheme = EditorView.theme({
	".numr-line-numbers": { display: "none !important" },
});

function widestResult(evaluation) {
	let widest = "";
	for (const result of evaluation.results) {
		if (
			!result.is_empty &&
			!result.is_error &&
			result.result.length > widest.length
		) {
			widest = result.result;
		}
	}
	return widest || "00000000";
}

function resultsGutter(session) {
	return gutter({
		class: "numr-results",
		side: "after",
		renderEmptyElements: true,
		lineMarker(view, block) {
			const line = view.state.doc.lineAt(block.from);
			const result = view.state.field(evaluationField).results[line.number - 1];
			return result && !result.is_empty && !result.is_error
				? new ResultMarker(
						session,
						result.result,
						line.from + session.expressionPrefixLength(line.text),
					)
				: null;
		},
		lineMarkerChange: evaluationChanged,
		initialSpacer: (view) =>
			new ResultMarker(session, widestResult(view.state.field(evaluationField))),
		updateSpacer: (_spacer, update) =>
			new ResultMarker(
				session,
				widestResult(update.state.field(evaluationField)),
			),
	});
}

const resultAlignment = ViewPlugin.fromClass(
	class {
			constructor(view) {
				this.schedule(view);
			}

			update(update) {
				if (
					evaluationChanged(update) ||
					update.geometryChanged ||
					update.viewportChanged
				) {
					this.schedule(update.view);
				}
			}

			docViewUpdate(view) {
				this.schedule(view);
			}

			schedule(view) {
				view.requestMeasure({
					key: this,
					read: (measuredView) =>
						[
							...measuredView.dom.querySelectorAll(
								"[data-numr-result-anchor]",
							),
						].map((marker) => {
							const anchor = Number(marker.dataset.numrResultAnchor);
							const markerRect = marker.getBoundingClientRect();
							const rowRect = marker.parentElement.getBoundingClientRect();
							const anchorRect = measuredView.coordsAtPos(anchor, -1);
							const maxOffset = Math.max(0, rowRect.height - markerRect.height);
							const offset = anchorRect
								? Math.min(maxOffset, Math.max(0, anchorRect.top - rowRect.top))
								: 0;
							return { marker, offset };
						}),
					write: (measurements) => {
						for (const { marker, offset } of measurements) {
							marker.style.top = `${offset}px`;
						}
					},
				});
			}
	},
);

function syntaxHighlighting(session) {
	return ViewPlugin.fromClass(
		class {
			constructor(view) {
				this.decorations = this.build(view);
			}

			update(update) {
				if (evaluationChanged(update) || update.viewportChanged) {
					this.decorations = this.build(update.view);
				}
			}

			build(view) {
				const decorations = [];
				const visitedLines = new Set();
				const variableNames = session.getVariableNames();

				for (const visible of view.visibleRanges) {
					let position = visible.from;
					while (position <= visible.to) {
						const line = view.state.doc.lineAt(position);
						if (!visitedLines.has(line.from)) {
							visitedLines.add(line.from);
							for (const token of tokenRanges(
								session,
								line.text,
								variableNames,
							)) {
								const from = line.from + token.from;
								const to = Math.min(line.from + token.to, line.to);
								if (to > from) {
									decorations.push(
										Decoration.mark({ class: token.className }).range(
											from,
											to,
										),
									);
								}
							}
						}
						if (line.to >= visible.to || line.to === view.state.doc.length) break;
						position = line.to + 1;
					}
				}

				return Decoration.set(decorations, true);
			}
		},
		{ decorations: (plugin) => plugin.decorations },
	);
}

const editorTheme = EditorView.theme(
	{
		"&": {
			height: "100%",
			minWidth: "0",
			minHeight: "0",
			backgroundColor: "var(--numr-bg-primary, #1a1c1e)",
			color: "var(--numr-text-primary, #e8eaed)",
			fontSize: "var(--numr-font-size, 14px)",
		},
		"&.cm-focused": { outline: "none" },
		// Safari zooms small editable text on focus. Keep both gutters on the
		// same metrics, including in embedded components with compact host fonts.
		"@media (any-pointer: coarse)": {
			".cm-scroller": { fontSize: "max(16px, var(--numr-font-size, 14px))" },
		},
		".cm-scroller": {
			overflow: "auto",
			fontFamily:
				"var(--numr-font-mono, var(--numr-font, ui-monospace, 'SF Mono', SFMono-Regular, 'Cascadia Code', Consolas, monospace))",
			lineHeight: "var(--numr-line-height, 1.5em)",
			overscrollBehavior: "none",
			tabSize: "2",
		},
		".cm-content": {
			minWidth: "max-content",
			padding: "0.5rem 0",
			caretColor: "var(--numr-accent, #eceef4)",
		},
		".cm-content.cm-lineWrapping": { minWidth: "0" },
		".cm-line": { padding: "0 0.75rem" },
		".cm-gutters": {
			backgroundColor: "var(--numr-bg-primary, #1a1c1e)",
			color: "var(--numr-text-muted, #6b7280)",
			border: "none",
		},
		".cm-gutterElement": {
			boxSizing: "border-box",
			lineHeight: "var(--numr-line-height, 1.5em)",
		},
		".numr-line-numbers": {
			minWidth: "calc(2ch + 7px + 1rem)",
			borderRight: "1px solid var(--numr-border, #2a2e32)",
		},
		".numr-line-numbers .cm-gutterElement": {
			padding: "0 0.33rem",
			textAlign: "right",
		},
		".numr-results": {
			borderLeft: "1px solid var(--numr-border, #2a2e32)",
		},
		".numr-results .cm-gutterElement": {
			position: "relative",
			padding: "0 0.75rem",
			textAlign: "right",
		},
		".numr-result[data-numr-result-anchor]": {
			position: "absolute",
			top: "0",
			right: "0.75rem",
		},
		".numr-line-number": {
			position: "relative",
			display: "inline-block",
			minWidth: "100%",
		},
		".numr-line-number-error": {
			color: "var(--numr-error, #f4a8a8)",
			cursor: "help",
		},
		".numr-error-bullet": {
			position: "absolute",
			left: "0",
			top: "50%",
			width: "6px",
			height: "6px",
			transform: "translateY(-50%)",
			borderRadius: "50%",
			backgroundColor: "var(--numr-error, #f4a8a8)",
		},
		".cm-selectionBackground, ::selection": {
			backgroundColor:
				"var(--numr-selection, rgba(236, 238, 244, 0.22))",
		},
		".numr-token-number": { color: "var(--numr-token-number, #b898f4)" },
		".numr-token-operator, .numr-token-keyword": {
			color: "var(--numr-token-operator, #f47898)",
		},
		".numr-token-variable": { color: "var(--numr-token-variable, #f4a860)" },
		".numr-token-unit": { color: "var(--numr-token-unit, #f4e878)" },
		".numr-token-currency, .numr-token-function": {
			color: "var(--numr-token-currency, #f4c244)",
		},
		".numr-token-comment": {
			color: "var(--numr-token-comment, #7d7868)",
			fontStyle: "italic",
		},
		".numr-token-text": { color: "var(--numr-token-text, #eceef4)" },
		".numr-token-punctuation": {
			color: "var(--numr-token-punctuation, #a8a498)",
		},
	},
	{ dark: true },
);

export class NumrEditor {
	constructor({
		parent,
		session,
		content = "",
		readOnly = false,
		lineWrapping = true,
		showLineNumbers = true,
		ariaLabel = "numr document",
		onDocumentChange = () => {},
		onChange = () => {},
		onError = (error) => console.error("Evaluation error", error),
	}) {
		this.session = session;
		this.onDocumentChange = onDocumentChange;
		this.onChange = onChange;
		this.onError = onError;
		this.readOnly = Boolean(readOnly);
		this.lineWrapping = Boolean(lineWrapping);
		this.showLineNumbers = Boolean(showLineNumbers);
		this.ariaLabel = ariaLabel;
		this.pendingFrame = null;
		this.destroyed = false;
		this.readOnlyCompartment = new Compartment();
		this.lineWrappingCompartment = new Compartment();
		this.lineNumbersCompartment = new Compartment();
		this.view = new EditorView({
			state: EditorState.create({
				doc: content,
				extensions: this.createExtensions(),
			}),
			parent,
		});
		this.handleGeometryChange = () => this.scheduleResultAlignment();
		this.resizeObserver = new ResizeObserver(this.handleGeometryChange);
		this.resizeObserver.observe(this.view.dom);
		document.fonts?.addEventListener("loadingdone", this.handleGeometryChange);
		document.fonts?.ready.then(this.handleGeometryChange);
		this.evaluateNow();
	}

	createExtensions() {
		return [
			evaluationField,
			history(),
			keymap.of([
				{ key: "Enter", run: insertNewline, shift: insertNewline },
				...standardKeymap,
				...historyKeymap,
			]),
			this.readOnlyCompartment.of([
				EditorState.readOnly.of(this.readOnly),
				EditorView.editable.of(!this.readOnly),
				EditorView.contentAttributes.of(this.contentAttributes()),
			]),
			this.lineWrappingCompartment.of(
				this.lineWrapping ? EditorView.lineWrapping : [],
			),
			this.lineNumbersCompartment.of(
				this.showLineNumbers ? [] : hiddenLineNumbersTheme,
			),
			lineNumbersGutter(),
			EditorView.updateListener.of((update) => {
				if (update.docChanged) {
					this.onDocumentChange(update.state.doc.toString());
					this.scheduleEvaluation();
				}
			}),
			gutters({ fixed: true }),
			resultsGutter(this.session),
			resultAlignment,
			syntaxHighlighting(this.session),
			editorTheme,
		];
	}

	contentAttributes() {
		return {
			"aria-label": this.ariaLabel,
			"aria-multiline": "true",
			"aria-readonly": String(this.readOnly),
			spellcheck: "false",
			autocapitalize: "off",
			autocomplete: "off",
		};
	}

	scheduleEvaluation() {
		if (this.pendingFrame !== null || this.destroyed) return;
		this.pendingFrame = requestAnimationFrame(() => {
			this.pendingFrame = null;
			this.evaluateNow();
		});
	}

	evaluateNow() {
		if (this.destroyed) return EMPTY_EVALUATION;
		if (this.pendingFrame !== null) {
			cancelAnimationFrame(this.pendingFrame);
			this.pendingFrame = null;
		}

		const content = this.getContent();
		let evaluation = EMPTY_EVALUATION;
		try {
			evaluation = this.session.evaluateDocument(content);
		} catch (error) {
			this.onError(error);
		}

		this.view.dispatch({ effects: setEvaluation.of(evaluation) });
		this.onChange({ content, ...evaluation });
		return evaluation;
	}

	getContent() {
		return this.view.state.doc.toString();
	}

	setContent(content) {
		const previous = this.getContent();
		const next =
			typeof content === "string" ? content : String(content ?? "");
		this.view.setState(
			EditorState.create({
				doc: next,
				extensions: this.createExtensions(),
			}),
		);
		if (next !== previous) this.onDocumentChange(next);
		this.evaluateNow();
	}

	setReadOnly(readOnly) {
		const next = Boolean(readOnly);
		if (next === this.readOnly) return;
		this.readOnly = next;
		this.view.dispatch({
			effects: this.readOnlyCompartment.reconfigure([
				EditorState.readOnly.of(next),
				EditorView.editable.of(!next),
				EditorView.contentAttributes.of(this.contentAttributes()),
			]),
		});
	}

	setLineWrapping(lineWrapping) {
		const next = Boolean(lineWrapping);
		if (next === this.lineWrapping) return;
		this.lineWrapping = next;
		this.view.dispatch({
			effects: this.lineWrappingCompartment.reconfigure(
				next ? EditorView.lineWrapping : [],
			),
		});
		this.scheduleResultAlignment();
	}

	setLineNumbers(showLineNumbers) {
		const next = Boolean(showLineNumbers);
		if (next === this.showLineNumbers) return;
		this.showLineNumbers = next;
		this.view.dispatch({
			effects: this.lineNumbersCompartment.reconfigure(
				next ? [] : hiddenLineNumbersTheme,
			),
		});
		this.scheduleResultAlignment();
	}

	scheduleResultAlignment() {
		if (this.destroyed) return;
		this.view.plugin(resultAlignment)?.schedule(this.view);
	}

	focus() {
		this.view.focus();
	}

	revealSelection() {
		if (this.destroyed || !this.view.hasFocus) return;
		this.view.dispatch({
			effects: EditorView.scrollIntoView(this.view.state.selection.main, { y: "nearest" }),
		});
	}

	destroy() {
		this.destroyed = true;
		this.resizeObserver.disconnect();
		document.fonts?.removeEventListener(
			"loadingdone",
			this.handleGeometryChange,
		);
		if (this.pendingFrame !== null) cancelAnimationFrame(this.pendingFrame);
		this.pendingFrame = null;
		this.view.destroy();
	}
}
