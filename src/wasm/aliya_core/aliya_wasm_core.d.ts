/* tslint:disable */
/* eslint-disable */

export class AliyaEngine {
    free(): void;
    [Symbol.dispose](): void;
    advance_time(seconds: number): string;
    choose(choice_id: string): string;
    clear_clock_override(): void;
    continue_after_wait(): string;
    debug_complete_interaction(control: string): string;
    debug_jump_daily_insert_to_index(flowchart: string, block: string, index: number): string;
    debug_jump_to(flowchart: string, block: string): string;
    debug_jump_to_index(flowchart: string, block: string, index: number): string;
    debug_set_achievement(achievement_id: string, value: boolean): void;
    debug_set_interaction_seed(control: string, is_open: boolean, can_interact?: boolean | null): void;
    debug_set_variable(key: string, variable_type: string, value: string): void;
    interact(control: string): string;
    load_json(save_json: string): string;
    constructor(flowcharts_json: string, localization_json: string);
    save_json(): string;
    set_clock_override_ms(millis: number): void;
    start(): string;
    state_json(): string;
    submit_input(text: string): string;
    tick(seconds: number): string;
    tune_radio(percent: number): string;
}

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_aliyaengine_free: (a: number, b: number) => void;
    readonly aliyaengine_advance_time: (a: number, b: number) => [number, number];
    readonly aliyaengine_choose: (a: number, b: number, c: number) => [number, number];
    readonly aliyaengine_clear_clock_override: (a: number) => void;
    readonly aliyaengine_continue_after_wait: (a: number) => [number, number];
    readonly aliyaengine_debug_complete_interaction: (a: number, b: number, c: number) => [number, number];
    readonly aliyaengine_debug_jump_daily_insert_to_index: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number];
    readonly aliyaengine_debug_jump_to: (a: number, b: number, c: number, d: number, e: number) => [number, number];
    readonly aliyaengine_debug_jump_to_index: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number];
    readonly aliyaengine_debug_set_achievement: (a: number, b: number, c: number, d: number) => void;
    readonly aliyaengine_debug_set_interaction_seed: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly aliyaengine_debug_set_variable: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => void;
    readonly aliyaengine_interact: (a: number, b: number, c: number) => [number, number];
    readonly aliyaengine_load_json: (a: number, b: number, c: number) => [number, number];
    readonly aliyaengine_new: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly aliyaengine_save_json: (a: number) => [number, number];
    readonly aliyaengine_set_clock_override_ms: (a: number, b: number) => void;
    readonly aliyaengine_start: (a: number) => [number, number];
    readonly aliyaengine_state_json: (a: number) => [number, number];
    readonly aliyaengine_submit_input: (a: number, b: number, c: number) => [number, number];
    readonly aliyaengine_tick: (a: number, b: number) => [number, number];
    readonly aliyaengine_tune_radio: (a: number, b: number) => [number, number];
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __externref_table_dealloc: (a: number) => void;
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
