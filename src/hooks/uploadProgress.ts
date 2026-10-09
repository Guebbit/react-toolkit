import { useCallback, useRef, useState } from 'react';

/**
 * Sink the request reports its progress to, as a 0–1 fraction (what HTTP clients hand out).
 */
export type TUploadProgressReporter = (fraction: number) => void;

/**
 * Builds your HTTP client's per-call options from the progress sink.
 * Written once per app, and the only client-specific part of this hook.
 */
export type TUploadOptionsBuilder<TOptions> = (onProgress: TUploadProgressReporter) => TOptions;

/**
 * Settings for one {@link useUploadProgress} `track` call.
 */
export interface ITrackUploadSettings {
    /**
     * Whether to track this call at all, default true.
     * Pass `!!file` on a form whose file is optional: a plain field edit sends bytes, and a bar
     * flashing to 100% for it reads as a glitch rather than as feedback.
     */
    enabled?: boolean;
}

/**
 * Progress state for one upload, and the wrapper that drives it.
 *
 * @param buildOptions - See {@link TUploadOptionsBuilder}
 */
export const useUploadProgress = <TOptions>(buildOptions: TUploadOptionsBuilder<TOptions>) => {
    /**
     * Percentage sent (0–100), or undefined while idle.
     *
     * The ref holds the live value for synchronous reads: a client fires several progress events
     * within one tick, and the bar has to follow them rather than the render schedule. The state
     * exists only to drive the re-render.
     */
    const progressRef = useRef<number | undefined>(undefined);
    const [, setProgressState] = useState<number | undefined>();

    /**
     * Latest builder without making it a dependency, so `track` stays stable across renders even
     * when the caller passes an inline arrow.
     */
    const buildOptionsRef = useRef(buildOptions);
    buildOptionsRef.current = buildOptions;

    const setProgress = useCallback((value: number | undefined) => {
        progressRef.current = value;
        setProgressState(value);
    }, []);

    /**
     * Record progress from a 0–1 fraction.
     * Clamped: a client reporting `loaded` against a stale total can exceed 1, and a bar rendered
     * from `width: 137%` breaks the layout rather than merely looking wrong.
     *
     * @param fraction
     */
    const report: TUploadProgressReporter = useCallback(
        (fraction) => {
            setProgress(Math.min(Math.max(fraction, 0), 1) * 100);
        },
        [setProgress]
    );

    /**
     * Return to idle.
     */
    const reset = useCallback(() => {
        setProgress(undefined);
    }, [setProgress]);

    /**
     * Run a request with progress tracking attached, returning to idle however it ends.
     *
     * @param send     - performs the call, receiving the built options (undefined when untracked)
     * @param settings - see {@link ITrackUploadSettings}
     * @returns whatever `send` produced, untouched — a rejection stays a rejection
     */
    const track = useCallback(
        <T>(
            send: (options?: TOptions) => Promise<T>,
            { enabled = true }: ITrackUploadSettings = {}
        ): Promise<T> => {
            if (!enabled) return send();

            // 0 from the moment the request is in flight: a bar that waits for the first progress
            // event never appears at all on a fast connection.
            setProgress(0);

            // `finally` forwards the value and re-throws the rejection untouched
            return send(buildOptionsRef.current(report)).finally(reset);
        },
        [setProgress, report, reset]
    );

    return {
        /**
         * Exposed as a getter so it reflects the latest value synchronously — progress events
         * arrive faster than React re-renders. The underlying state still drives the re-render.
         */
        get progress() {
            return progressRef.current;
        },
        /**
         * Whether an upload is currently being tracked.
         *
         * undefined and 0 are different states: undefined is "nothing is uploading", 0 is
         * "started, nothing sent yet". Show the bar for the second, hide it for the first.
         */
        get isUploading() {
            return progressRef.current !== undefined;
        },
        report,
        reset,
        track
    };
};

/**
 * Everything {@link useUploadProgress} returns.
 */
export type IUploadProgress<TOptions> = ReturnType<typeof useUploadProgress<TOptions>>;
