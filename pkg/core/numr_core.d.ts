/* tslint:disable */
/* eslint-disable */

/**
 * WASM-compatible wrapper for the numr Engine
 */
export class WasmEngine {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Apply exchange rates from JSON object: {"EUR": 0.92, "BTC": 95000, ...}
     */
    apply_rates(rates_json: string): number;
    /**
     * Clear all state
     */
    clear(): void;
    /**
     * Evaluate a single line and return the result as a JSON string
     */
    eval(input: string): string;
    /**
     * Evaluate multiple lines from a document, returns JSON array of results
     */
    eval_document(content: string): string;
    /**
     * Evaluate a document and return results, totals, and variable names together.
     */
    eval_document_full(content: string): string;
    /**
     * Evaluate without storing the result (for live preview)
     */
    eval_preview(input: string): string;
    /**
     * Currency and rate-provider metadata from the core registry.
     */
    get_currency_catalog(): string;
    /**
     * Get all line results as JSON
     */
    get_lines(): string;
    /**
     * Get grouped totals as JSON
     */
    get_totals(): string;
    /**
     * Get user variable names, one per line.
     */
    get_variable_names(): string;
    /**
     * Get all variables as JSON
     */
    get_variables(): string;
    /**
     * Create a new engine instance
     */
    constructor();
}

/**
 * Initialize panic hook for better error messages in the browser console
 */
export function init(): void;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_wasmengine_free: (a: number, b: number) => void;
    readonly wasmengine_apply_rates: (a: number, b: number, c: number, d: number) => void;
    readonly wasmengine_clear: (a: number) => void;
    readonly wasmengine_eval: (a: number, b: number, c: number, d: number) => void;
    readonly wasmengine_eval_document: (a: number, b: number, c: number, d: number) => void;
    readonly wasmengine_eval_document_full: (a: number, b: number, c: number, d: number) => void;
    readonly wasmengine_eval_preview: (a: number, b: number, c: number, d: number) => void;
    readonly wasmengine_get_currency_catalog: (a: number, b: number) => void;
    readonly wasmengine_get_lines: (a: number, b: number) => void;
    readonly wasmengine_get_totals: (a: number, b: number) => void;
    readonly wasmengine_get_variable_names: (a: number, b: number) => void;
    readonly wasmengine_get_variables: (a: number, b: number) => void;
    readonly wasmengine_new: () => number;
    readonly init: () => void;
    readonly __wbindgen_export: (a: number, b: number, c: number) => void;
    readonly __wbindgen_export2: (a: number, b: number) => number;
    readonly __wbindgen_export3: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_add_to_stack_pointer: (a: number) => number;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
