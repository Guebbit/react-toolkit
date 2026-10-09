import { useCallback, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { type ZodType } from 'zod';
import { runAsPromise } from '../utils/promise';

/**
 * In practice the form element, declared structurally so this hook never names a DOM type
 * (the result is only ever runtime-checked for a callable `focus`).
 */
export interface IFieldContainer {
    querySelector: (selectors: string) => unknown;
}

/**
 * The ways a caller can hand over the form element: the element itself, the `useRef` object
 * holding it (what a `ref={formRef}` produces, and the usual case), or a getter.
 */
export type TFieldContainerSource =
    | IFieldContainer
    | null
    | undefined
    | { current: IFieldContainer | null | undefined }
    | (() => IFieldContainer | null | undefined);

/**
 * Default selector for the field revealErrors() focuses.
 *
 * `aria-invalid` rather than `:invalid` or a UI kit's error class: it is the one marker that is
 * both standard and authored, since a component rendering its own wrapper still has to set it for
 * screen readers.
 */
export const DEFAULT_INVALID_FIELD_SELECTOR = '[aria-invalid="true"]';

/**
 * Options for {@link useStructureFormValidation}.
 */
export interface IStructureFormValidationOptions<
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    T extends Record<string, any> = Record<string, any>
> {
    /**
     * Dependency list that, when it changes, re-runs validation over the UNCHANGED form data.
     *
     * The case this exists for is a language switch. Zod hands back resolved message *strings*,
     * and {@link useStructureFormValidation} copies them into `formErrors`, so once `validate()`
     * has returned those strings are inert text: the schema is out of the picture and
     * re-rendering just re-prints the same English error under a now-Italian label. Re-parsing
     * the same data produces the same set of errors with different strings.
     *
     * Deliberately a plain dependency array rather than a `locale` option: the toolkit must not
     * know that any particular i18n library exists, and "re-validate when X changes" covers other
     * reasons too (a unit system, a tenant's rules). Pass `[i18n.language]` and you have the i18n
     * behaviour.
     *
     * Follows React's own dependency-array rules: keep its length constant across renders.
     *
     * Only fires for a form that has errors on display, and never on mount. A pristine form the
     * user has not submitted yet must not sprout red text just because they changed the language.
     */
    revalidateOn?: unknown[];

    /**
     * The form element, so revealErrors() can focus the first invalid field.
     * Omitting it makes revealErrors() a pure state change with no DOM access — what a form
     * rendered under SSR or in a node test needs.
     *
     * Normally the `useRef` object you already attach with `ref=`:
     *
     *     const formRef = useRef<HTMLFormElement>(null);
     *     const form = useStructureFormValidation(EMPTY, schema, { formElement: formRef });
     */
    formElement?: TFieldContainerSource;

    /**
     * Selector for the field to focus, default {@link DEFAULT_INVALID_FIELD_SELECTOR}.
     * Override it for a UI kit that marks the wrapper rather than the control, since focus has to
     * land on something focusable.
     */
    invalidFieldSelector?: string;

    /**
     * Called after a submit was rejected by validation, once the errors are on screen.
     * The "please fix the highlighted fields" toast belongs here rather than at every call site.
     *
     * @param errors
     */
    onInvalid?: (errors: Partial<Record<keyof T, string[]>>) => void;
}

/**
 * How applyServerErrors was told to read a rejection.
 */
export interface IApplyServerErrorsOptions<
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    T extends Record<string, any> = Record<string, any>
> {
    /**
     * Renames server field names to form field names (`user_email` -> `email`).
     * Names absent from the map are used as-is, so only the exceptions need listing.
     */
    map?: Record<string, keyof T>;

    /**
     * Receives messages that could not be attached to a field: the API's form-level errors, and
     * any field the form does not have. Without it they are dropped, which is what makes people
     * distrust server-side validation — the API said no, and the screen says nothing.
     */
    onUnmapped?: (messages: string[]) => void;
}

/**
 * One server-reported error: the field it belongs to (if any) and what to say about it.
 */
interface IServerErrorEntry {
    field?: string;
    messages: string[];
}

/**
 * Narrows any value to a plain keyed object.
 *
 * @param value
 */
const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null;

/**
 * Resolve the form element out of whichever of the accepted shapes the caller passed.
 *
 * `querySelector` is checked before `current` deliberately: a container is identified by what it
 * can do, so an element that happens to have a `current` property is still the element.
 *
 * @param source
 */
const readContainer = (source: TFieldContainerSource): IFieldContainer | undefined | null => {
    const resolved: unknown = typeof source === 'function' ? source() : source;
    if (!isRecord(resolved)) return undefined;
    if (typeof resolved.querySelector === 'function') return resolved as unknown as IFieldContainer;
    if ('current' in resolved) return resolved.current as IFieldContainer | null | undefined;
    return undefined;
};

/**
 * Coerce a server-supplied message value — one string or a list — into a clean list.
 *
 * @param value
 */
const asMessages = (value: unknown): string[] => {
    if (typeof value === 'string') return value ? [value] : [];
    if (Array.isArray(value))
        return value.filter(
            (message): message is string => typeof message === 'string' && !!message
        );
    return [];
};

/**
 * Read the field name out of one entry of an array-shaped error list.
 *
 * Covers `field`, `name`, `param` (express-validator) and `path` (a string, or the array Zod
 * emits). Nested paths collapse to their root, since formErrors is keyed by top-level field —
 * the same thing validate() does with Zod issues.
 *
 * @param entry
 */
const readEntryField = (entry: Record<string, unknown>): string | undefined => {
    for (const key of ['field', 'name', 'param']) {
        const value = entry[key];
        if (typeof value === 'string' && value) return value;
    }
    const { path } = entry;
    if (typeof path === 'string' && path) return path;
    if (Array.isArray(path) && typeof path[0] === 'string' && path[0]) return path[0];
    return undefined;
};

/**
 * Find the error collection inside a rejection, wherever the transport left it: the value itself
 * (a normalized envelope), `.data` (an unwrapped body), or `.response.data` (a raw axios error).
 *
 * @param error
 */
const findErrorCollection = (error: unknown): unknown => {
    const containers: unknown[] = [error];
    if (isRecord(error)) {
        containers.push(error.data);
        if (isRecord(error.response)) containers.push(error.response.data);
    }
    for (const container of containers) {
        if (!isRecord(container)) continue;
        if (container.errors !== undefined) return container.errors;
        if (container.issues !== undefined) return container.issues;
    }
    return undefined;
};

/**
 * Flatten whichever shape the API used into a uniform entry list:
 *  - field map, `{ email: 'Taken', password: ['Too short'] }`
 *  - list of objects, `[{ field: 'email', message: 'Taken' }]`
 *  - list of strings, which carry no field and become form-level messages
 *
 * @param collection
 */
const normalizeServerErrors = (collection: unknown): IServerErrorEntry[] => {
    if (Array.isArray(collection))
        return collection
            .map((entry): IServerErrorEntry => {
                if (typeof entry === 'string') return { messages: asMessages(entry) };
                if (!isRecord(entry)) return { messages: [] };
                return {
                    field: readEntryField(entry),
                    messages: asMessages(entry.message ?? entry.msg)
                };
            })
            .filter(({ messages }) => messages.length > 0);

    if (isRecord(collection))
        return Object.entries(collection)
            .map(([field, value]): IServerErrorEntry => ({ field, messages: asMessages(value) }))
            .filter(({ messages }) => messages.length > 0);

    return [];
};

/**
 * Form management custom hook.
 * Handles reactive form state, optional Zod schema validation and submission flow.
 *
 * @param initialData - Initial values for the form fields
 * @param schema      - Optional Zod schema used for validation, or a factory returning one.
 *                      `schema` is resolved inside `validate()` and nowhere else, so a plain
 *                      schema whose messages are thunks (`error: () => t('…')`) is resolved just
 *                      as late as a factory would be — prefer the plain schema, since a factory
 *                      that is accidentally called at the call site (`createSchema(t)` instead of
 *                      `() => createSchema(t)`) type-checks, runs, and silently freezes the
 *                      language.
 * @param options     - See {@link IStructureFormValidationOptions}
 */
export const useStructureFormValidation = <
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    T extends Record<string, any> = Record<string, any>
>(
    initialData: T = {} as T,
    schema?: ZodType<T> | (() => ZodType<T>),
    options: IStructureFormValidationOptions<T> = {}
) => {
    /**
     * Latest options without making them a dependency of anything: `formElement`,
     * `invalidFieldSelector` and `onInvalid` are read at the moment they are used, so an inline
     * options object rebuilt every render neither destabilises the returned callbacks nor
     * strands them on the first render's values.
     */
    const optionsRef = useRef(options);
    optionsRef.current = options;

    /**
     * Baseline values resetForm() restores and isDirty compares against.
     * Starts as a copy of initialData, but is mutable via setInitialData so a
     * record fetched after this hook was created can become the new
     * baseline (see setInitialData / activateAutoHydrate).
     *
     * The ref holds the canonical live value for synchronous access in callbacks.
     * The state drives re-renders (so isDirty recomputes after setInitialData).
     */
    const initialFormDataRef = useRef<T>({ ...initialData });
    const [initialFormData, setInitialFormDataState] = useState<T>(() => ({ ...initialData }));

    /**
     * Reactive form data.
     *
     * The ref holds the live form value for synchronous reads inside callbacks
     * (e.g. validate() and handleSubmit() read the form the same tick setForm
     * was called). The state drives re-renders.
     */
    const formRef = useRef<T>({ ...initialData });
    const [form, setFormState] = useState<T>(() => ({ ...initialData }));

    /**
     * Per-field validation errors.
     * Each key maps to a list of error messages for that field.
     */
    const [formErrors, setFormErrors] = useState<Partial<Record<keyof T, string[]>>>({});

    /**
     * The errors as of the latest render, for the callbacks that must read them without listing
     * them as a dependency (see revealErrors and the revalidateOn effect).
     */
    const formErrorsRef = useRef(formErrors);
    formErrorsRef.current = formErrors;

    /**
     * Whether the UI should surface {@link formErrors} yet — flipped on by revealErrors (and so
     * by a submit validation rejects), off by a submit that validates.
     */
    const [showFormErrors, setShowFormErrors] = useState(false);

    /**
     * Whether a submission is currently in progress.
     *
     * The ref allows synchronous reads inside handleSubmit (e.g. reading
     * isSubmitting from inside the onSubmit callback in the same tick it was
     * set to true). The state drives re-renders.
     */
    const isSubmittingRef = useRef(false);
    const [, setIsSubmittingState] = useState(false);

    /**
     * Merge partial data into the form
     *
     * @param data
     */
    const setForm = useCallback((data: Partial<T>) => {
        const next = { ...formRef.current, ...data } as T;
        formRef.current = next;
        setFormState(next);
    }, []);

    /**
     * Reset form to initial values and clear all errors
     */
    const resetForm = useCallback(() => {
        const initial = { ...initialFormDataRef.current };
        formRef.current = initial;
        setFormState(initial);
        setFormErrors({});
    }, []);

    /**
     * Replace the baseline values that resetForm() restores and isDirty compares
     * against. Does not touch the live form or its errors by itself — call
     * resetForm() afterwards (or see activateAutoHydrate) to apply it to `form`.
     *
     * @param data
     */
    const setInitialData = useCallback((data: T) => {
        const next = { ...data };
        initialFormDataRef.current = next;
        setInitialFormDataState(next);
    }, []);

    /**
     * Clear all validation errors
     */
    const clearErrors = useCallback(() => {
        setFormErrors({});
    }, []);

    /**
     * Set validation error(s) for a specific field
     *
     * @param field
     * @param errors - a single message or an array of messages
     */
    const setFieldError = useCallback((field: keyof T, errors: string | string[]) => {
        setFormErrors((prev) => ({
            ...prev,
            [field]: Array.isArray(errors) ? errors : [errors]
        }));
    }, []);

    /**
     * Remove validation errors for a specific field
     *
     * @param field
     */
    const clearFieldError = useCallback((field: keyof T) => {
        setFormErrors((prev) => {
            const { [field]: _removed, ...rest } = prev;
            return rest as Partial<Record<keyof T, string[]>>;
        });
    }, []);

    /**
     * Validate the current form value against the schema (if provided).
     * Updates {@link formErrors} reactively.
     *
     * @returns true when validation passes (or no schema is set), false otherwise
     */
    const validate = useCallback((): boolean => {
        if (!schema) {
            setFormErrors({});
            return true;
        }

        const resolvedSchema = typeof schema === 'function' ? schema() : schema;
        const result = resolvedSchema.safeParse(formRef.current);

        if (result.success) {
            setFormErrors({});
            return true;
        }

        const errors: Partial<Record<keyof T, string[]>> = {};
        for (const issue of result.error.issues) {
            const field = issue.path[0] as keyof T;
            if (field === undefined) continue;
            if (!errors[field]) errors[field] = [];
            errors[field]!.push(issue.message);
        }
        setFormErrors(errors);

        return false;
    }, [schema]);

    /**
     * Move focus to the first invalid field, for accessibility after a failed submit.
     * A no-op without formElement, and tolerant of what it finds: the selector is
     * caller-configurable, so only something with a callable focus is worth acting on.
     */
    const focusFirstInvalidField = useCallback((): void => {
        const { formElement, invalidFieldSelector } = optionsRef.current;
        const container = readContainer(formElement);
        if (!container) return;
        const field = container.querySelector(
            invalidFieldSelector ?? DEFAULT_INVALID_FIELD_SELECTOR
        );
        if (isRecord(field) && typeof field.focus === 'function')
            (field.focus as () => void).call(field);
    }, []);

    /**
     * Put the errors already in formErrors on screen: showFormErrors on, wait for the render,
     * focus the first invalid field, call onInvalid.
     *
     * The wait is why this is a function returning a promise and not an assignment: fields only
     * acquire their invalid markers once showFormErrors has propagated, so focusing any earlier
     * finds nothing. `flushSync` is what turns that wait into a guarantee — it renders and
     * commits before it returns, so the query below runs against a DOM that already carries the
     * markers. An effect would read the same DOM one tick later, but nothing could then await it:
     * a promise only a commit can settle deadlocks under `act`, which defers every flush.
     *
     * Deferred by a microtask so the flush never lands inside a render or a batch React is
     * already processing, which is the one place flushSync is not allowed.
     *
     * Called by handleSubmit; call it directly when you validate by hand.
     */
    const revealErrors = useCallback(
        (): Promise<void> =>
            Promise.resolve().then(() => {
                // Also flushes the setFormErrors a preceding validate() queued, so the markers
                // being focused and the errors handed to onInvalid are the same generation.
                flushSync(() => {
                    setShowFormErrors(true);
                });
                focusFirstInvalidField();
                optionsRef.current.onInvalid?.(formErrorsRef.current);
            }),
        [focusFirstInvalidField]
    );

    /**
     * Attach the errors an API rejected a submit with to the fields they belong to, and reveal
     * them. Turns "uniqueness / cross-record rules the browser cannot check" into red text under
     * the right input instead of a generic toast.
     *
     * Merges onto what is already displayed rather than replacing it: an API that answered about
     * one field said nothing about the others, and clearing them invents an all-clear.
     *
     * @param error   - the rejected value, exactly as caught
     * @param options - see {@link IApplyServerErrorsOptions}
     * @returns true when at least one field error was attached. false means the rejection carried
     *          nothing displayable, i.e. the caller still owes the user a message
     */
    const applyServerErrors = useCallback(
        (error: unknown, { map, onUnmapped }: IApplyServerErrorsOptions<T> = {}): boolean => {
            const entries = normalizeServerErrors(findErrorCollection(error));
            const applied: Partial<Record<keyof T, string[]>> = {};
            const unmapped: string[] = [];

            for (const { field, messages } of entries) {
                const target =
                    field === undefined ? undefined : ((map?.[field] ?? field) as keyof T);
                // A field the form does not have cannot be highlighted, so it is form-level copy
                if (target === undefined || !(target in formRef.current)) {
                    unmapped.push(...messages);
                    continue;
                }
                applied[target] = [...(applied[target] ?? []), ...messages];
            }

            if (unmapped.length > 0) onUnmapped?.(unmapped);

            if (Object.keys(applied).length === 0) return false;

            setFormErrors((previous) => ({ ...previous, ...applied }));
            setShowFormErrors(true);
            return true;
        },
        []
    );

    /**
     * Validate (optionally) and then call the provided submit handler.
     * Sets {@link isSubmitting} for the duration of the async operation.
     *
     * Owns showFormErrors across the whole flow, so no call site has to: a rejected submit
     * reveals (see revealErrors), an accepted one hides. A handler that THROWS leaves it off —
     * an API failure is not a statement about any field. Catch it and call applyServerErrors
     * when it is.
     *
     * @param onSubmit       - handler called with the current form value
     * @param withValidation - when true (default) the form is validated first
     * @returns true on success, false when validation failed or an error was thrown
     */
    const handleSubmit = useCallback(
        (onSubmit: (data: T) => Promise<void> | void, withValidation = true): Promise<boolean> => {
            if (withValidation && !validate()) return revealErrors().then(() => false);

            setShowFormErrors(false);
            isSubmittingRef.current = true;
            setIsSubmittingState(true);

            const settle = () => {
                isSubmittingRef.current = false;
                setIsSubmittingState(false);
            };

            // runAsPromise calls the handler synchronously and turns a synchronous throw inside it
            // into a rejection; the two arms then reset isSubmitting in the same tick the returned
            // promise settles. Between them they reproduce exactly what `await` in a
            // `try`/`finally` did — see src/utils/promise.ts for why the timing is load-bearing.
            return runAsPromise(() => onSubmit(formRef.current)).then(
                () => {
                    settle();
                    return true;
                },
                (error: unknown) => {
                    settle();
                    throw error;
                }
            );
        },
        [validate, revealErrors]
    );

    /**
     * Adopts `item` as the new reset baseline (setInitialData) and applies it to
     * the form (resetForm), so the form hydrates once a fetched record arrives
     * instead of staying on the original initialData passed to this hook.
     *
     * Call it straight from the hook body with the record you are waiting on
     * (e.g. `selectedRecord` from useStructureRestApi) — it is idempotent, and
     * only re-hydrates when the value it is given actually changes:
     *
     *     const form = useStructureFormValidation(EMPTY, schema);
     *     form.activateAutoHydrate(api.selectedRecord);
     *
     * @param item - the record to hydrate from, or undefined while it is pending
     */
    const hydratedFromRef = useRef<string | undefined>(undefined);
    const activateAutoHydrate = useCallback((item?: T | null) => {
        if (!item) return;
        // Compared by value, not identity: a re-fetch that resolves to an
        // equal record produces a new object every time, and re-hydrating on
        // that would wipe whatever the user has typed since. JSON is the same
        // comparison isDirty already uses.
        const fingerprint = JSON.stringify(item);
        if (hydratedFromRef.current === fingerprint) return;
        hydratedFromRef.current = fingerprint;
        const next = { ...item };
        initialFormDataRef.current = next;
        setInitialFormDataState(next);
        formRef.current = next;
        setFormState(next);
        setFormErrors({});
    }, []);

    /**
     * Re-translate what is already on screen — see {@link IStructureFormValidationOptions}.
     *
     * `validate()` is deterministic on the current form value, so re-running it against unchanged
     * data yields the same set of errors with freshly-resolved messages.
     *
     * Two guards, and both are load-bearing. The mount skip is what makes this behave like a
     * change listener rather than an extra validate on first render — `useEffect` runs on mount
     * and Vue's `watch` does not, and running here would validate a form the user has not touched.
     * The `formErrors` check is the same protection one render later: with nothing on display
     * there is nothing to re-translate, and running anyway would splash red onto a pristine form.
     *
     * `formErrors` is read through a ref rather than listed as a dependency, so this fires ONLY
     * for the caller's sources — adding `formErrors` would re-run it every time validation
     * changed anything, which is a loop.
     */
    const hasMountedRef = useRef(false);
    const { revalidateOn } = options;

    useEffect(() => {
        if (!hasMountedRef.current) {
            hasMountedRef.current = true;
            return;
        }
        if (Object.keys(formErrorsRef.current).length > 0) validate();
        // The dependency list is the caller's `revalidateOn`, deliberately — `validate` is not
        // in it, or a schema rebuilt each render would re-fire this on every render.
    }, revalidateOn ?? []);

    return {
        form,
        formErrors,
        showFormErrors,
        setShowFormErrors,
        /**
         * isSubmitting is exposed as a getter so it reflects the latest value
         * synchronously (e.g. reading it inside the onSubmit callback the same
         * tick it was set to true). The underlying state still drives re-renders.
         */
        get isSubmitting() {
            return isSubmittingRef.current;
        },
        /**
         * True when there are no validation errors
         */
        get isValid() {
            return Object.keys(formErrors).length === 0;
        },
        /**
         * True when the form data differs from the initial values
         */
        get isDirty() {
            return JSON.stringify(form) !== JSON.stringify(initialFormData);
        },
        setForm,
        resetForm,
        setInitialData,
        activateAutoHydrate,
        clearErrors,
        setFieldError,
        clearFieldError,
        applyServerErrors,
        validate,
        revealErrors,
        handleSubmit
    };
};

/**
 * Everything {@link useStructureFormValidation} returns, for consumers that need to name the
 * shape (a store that re-exports it, a component prop, a test helper).
 */
export type IStructureFormValidation<
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    T extends Record<string, any> = Record<string, any>
> = ReturnType<typeof useStructureFormValidation<T>>;
