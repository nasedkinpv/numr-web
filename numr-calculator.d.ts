/**
 * Type definitions for <numr-calculator> web component
 */

export interface NumrResult {
  input: string;
  result: string;
  is_empty: boolean;
  is_error: boolean;
}

export interface NumrChangeEventDetail {
  content: string;
  results: NumrResult[];
  totals: string[];
}

export interface NumrCalculatorEventMap {
  "numr-ready": CustomEvent<void>;
  "numr-change": CustomEvent<NumrChangeEventDetail>;
}

export class NumrCalculator extends HTMLElement {
  /** Initial content to display */
  content: string;

  /** Hide header and footer */
  minimal: boolean;

  /** Make editor read-only (non-editable) */
  readonly: boolean;

  /** Skip fetching exchange rates */
  norates: boolean;

  /** Auto-save content to localStorage */
  autosave: boolean;

  /** localStorage key for autosave (default: 'numr-document') */
  storageKey: string;

  /** Base path for WASM files (default: '') */
  basePath: string;

  /** Get current editor content */
  getContent(): string;

  /** Set editor content programmatically */
  setContent(content: string): void;

  /** Clear the document and reset engine state */
  clear(): void;

  /** Refresh exchange rates from API */
  refreshRates(): void;

  /** Focus the editor */
  focus(): void;

  addEventListener<K extends keyof NumrCalculatorEventMap>(
    type: K,
    listener: (this: NumrCalculator, ev: NumrCalculatorEventMap[K]) => void,
    options?: boolean | AddEventListenerOptions,
  ): void;

  removeEventListener<K extends keyof NumrCalculatorEventMap>(
    type: K,
    listener: (this: NumrCalculator, ev: NumrCalculatorEventMap[K]) => void,
    options?: boolean | EventListenerOptions,
  ): void;
}

declare global {
  interface HTMLElementTagNameMap {
    "numr-calculator": NumrCalculator;
  }
}
