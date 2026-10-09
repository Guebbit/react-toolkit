import { act, renderHook } from '@testing-library/react';
import { useUploadProgress } from '../src/hooks/uploadProgress';

/**
 * Stand-in for an HTTP client's per-call options: the hook only ever builds this and hands it
 * back to `send`, so a wrapper around the reporter is all a test needs.
 */
interface IFakeOptions {
    onProgress: (fraction: number) => void;
}

const buildOptions = (onProgress: (fraction: number) => void): IFakeOptions => ({ onProgress });

/** `expect.any` is untyped, so it is named once here rather than cast at each call site. */
const ANY_FUNCTION: unknown = expect.any(Function);

/**
 * `result` rather than a snapshot of `result.current`: every assertion reads through the live
 * render, while `progress`/`isUploading` are getters over a ref, so a progress event fired inside
 * `send` is visible before React has re-rendered.
 */
const makeUpload = () => {
    const { result } = renderHook(() => useUploadProgress<IFakeOptions>(buildOptions));
    return result;
};

describe('useUploadProgress', () => {
    let upload: ReturnType<typeof makeUpload>;

    beforeEach(() => {
        upload = makeUpload();
    });

    // ─── idle state ───────────────────────────────────────────────────────────

    describe('idle state', () => {
        it('starts idle, which is not the same as zero', () => {
            expect(upload.current.progress).toBeUndefined();
            expect(upload.current.isUploading).toBe(false);
        });

        it('returns to idle after a successful upload', async () => {
            await act(async () => {
                await upload.current.track(() => Promise.resolve('done'));
            });
            expect(upload.current.progress).toBeUndefined();
            expect(upload.current.isUploading).toBe(false);
        });

        it('returns to idle after a failed upload', async () => {
            await expect(
                act(async () => {
                    await upload.current.track(() => Promise.reject(new Error('boom')));
                })
            ).rejects.toThrow('boom');
            expect(upload.current.progress).toBeUndefined();
        });
    });

    // ─── track ────────────────────────────────────────────────────────────────

    describe('track', () => {
        it('passes the resolved value through untouched', async () => {
            let resolved: { id: number } | undefined;
            await act(async () => {
                resolved = await upload.current.track(() => Promise.resolve({ id: 7 }));
            });
            expect(resolved).toEqual({ id: 7 });
        });

        it('re-throws the original rejection reason', async () => {
            const reason = new Error('network error');
            let caught: unknown;
            await act(async () => {
                caught = await upload.current
                    .track(() => Promise.reject(reason))
                    .catch((error: unknown) => error);
            });
            expect(caught).toBe(reason);
        });

        it('shows the bar as soon as the request is in flight', async () => {
            let inFlight: number | undefined = -1;
            await act(async () => {
                await upload.current.track(() => {
                    inFlight = upload.current.progress;
                    return Promise.resolve();
                });
            });
            // 0, not undefined: the request has started and nothing has gone out yet.
            expect(inFlight).toBe(0);
        });

        it('hands the built options to send', async () => {
            const send = jest.fn().mockResolvedValue('done');
            await act(async () => {
                await upload.current.track(send);
            });
            expect(send).toHaveBeenCalledWith(
                expect.objectContaining({ onProgress: ANY_FUNCTION })
            );
        });

        it('reports progress as a percentage while the request runs', async () => {
            const seen: (number | undefined)[] = [];
            await act(async () => {
                await upload.current.track((options) => {
                    options?.onProgress(0.25);
                    seen.push(upload.current.progress);
                    options?.onProgress(1);
                    seen.push(upload.current.progress);
                    return Promise.resolve();
                });
            });
            expect(seen).toEqual([25, 100]);
        });

        it('clamps a fraction the client reported out of range', async () => {
            const seen: (number | undefined)[] = [];
            await act(async () => {
                await upload.current.track((options) => {
                    options?.onProgress(1.37);
                    seen.push(upload.current.progress);
                    options?.onProgress(-2);
                    seen.push(upload.current.progress);
                    return Promise.resolve();
                });
            });
            // A bar rendered from `width: 137%` breaks the layout rather than merely looking wrong.
            expect(seen).toEqual([100, 0]);
        });
    });

    // ─── enabled ──────────────────────────────────────────────────────────────

    describe('enabled', () => {
        it('skips tracking entirely, and passes no options, when disabled', async () => {
            const duringCall: (number | undefined)[] = [];
            const send = jest.fn().mockImplementation(() => {
                duringCall.push(upload.current.progress);
                return Promise.resolve('done');
            });

            await act(async () => {
                await upload.current.track(send, { enabled: false });
            });

            expect(send).toHaveBeenCalledWith();
            // Never left idle: no bar flashes to 100% for a payload measured in bytes.
            expect(duringCall).toEqual([undefined]);
        });

        it('still resolves with the value when disabled', async () => {
            let resolved: string | undefined;
            await act(async () => {
                resolved = await upload.current.track(() => Promise.resolve('done'), {
                    enabled: false
                });
            });
            expect(resolved).toBe('done');
        });

        it('tracks by default', async () => {
            const send = jest.fn().mockResolvedValue('done');
            await act(async () => {
                await upload.current.track(send, {});
            });
            expect(send).toHaveBeenCalledWith(
                expect.objectContaining({ onProgress: ANY_FUNCTION })
            );
        });
    });

    // ─── manual control ───────────────────────────────────────────────────────

    describe('report / reset', () => {
        it('can be driven directly, for a client that reports progress its own way', () => {
            act(() => {
                upload.current.report(0.5);
            });
            expect(upload.current.progress).toBe(50);
            expect(upload.current.isUploading).toBe(true);

            act(() => {
                upload.current.reset();
            });
            expect(upload.current.progress).toBeUndefined();
        });
    });
});
