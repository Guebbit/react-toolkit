import { useCallback, useRef } from 'react';
import { type ZodType } from 'zod';
import { useLiveState } from '../utils/useLiveState';

/**
 * Form management custom hook.
 * Handles reactive form state, optional Zod schema validation and submission flow.
 *
 * Every value below is exposed as a GETTER over live state rather than as a
 * plain per-render property, because a form is read back within the tick it is
 * written: a submit handler calls `setForm(...)` and then `validate()`, and
 * reads `isSubmitting` from inside its own `onSubmit`. A per-render snapshot
 * would hand all of those the value from before the write. See {@link useLiveState}.
 *
 * @param initialData - Initial values for the form fields
 * @param schema      - Optional Zod schema used for validation
 */
export const useStructureFormValidation = <
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    T extends Record<string, any> = Record<string, any>
>(
    initialData: T = {} as T,
    schema?: ZodType<T>
) => {
    /**
     * Baseline values resetForm() restores and isDirty compares against.
     * Starts as a copy of initialData, but is mutable via setInitialData so a
     * record fetched after this hook was created can become the new
     * baseline (see setInitialData / activateAutoHydrate).
     */
    const [initialFormDataRef, setInitialFormData] = useLiveState<T>(() => ({ ...initialData }));

    /**
     * Reactive form data
     */
    const [formRef, setFormValue] = useLiveState<T>(() => ({ ...initialData }));

    /**
     * Per-field validation errors.
     * Each key maps to a list of error messages for that field.
     */
    const [formErrorsRef, setFormErrors] = useLiveState<Partial<Record<keyof T, string[]>>>({});

    /**
     * Whether the UI should surface {@link formErrors} yet — typically flipped on
     * after the first submit attempt, so a pristine form isn't shown as invalid.
     */
    const [showFormErrorsRef, setShowFormErrors] = useLiveState(false);

    /**
     * Whether a submission is currently in progress
     */
    const [isSubmittingRef, setIsSubmitting] = useLiveState(false);

    /**
     * Merge partial data into the form
     *
     * @param data
     */
    const setForm = useCallback(
        (data: Partial<T>) => {
            setFormValue({ ...formRef.current, ...data } as T);
        },
        [setFormValue, formRef]
    );

    /**
     * Reset form to initial values and clear all errors
     */
    const resetForm = useCallback(() => {
        setFormValue({ ...initialFormDataRef.current });
        setFormErrors({});
    }, [setFormValue, setFormErrors, initialFormDataRef]);

    /**
     * Replace the baseline values that resetForm() restores and isDirty compares
     * against. Does not touch the live form or its errors by itself — call
     * resetForm() afterwards (or see activateAutoHydrate) to apply it to `form`.
     *
     * @param data
     */
    const setInitialData = useCallback(
        (data: T) => {
            setInitialFormData({ ...data });
        },
        [setInitialFormData]
    );

    /**
     * Clear all validation errors
     */
    const clearErrors = useCallback(() => {
        setFormErrors({});
    }, [setFormErrors]);

    /**
     * Set validation error(s) for a specific field
     *
     * @param field
     * @param errors - a single message or an array of messages
     */
    const setFieldError = useCallback(
        (field: keyof T, errors: string | string[]) => {
            setFormErrors({
                ...formErrorsRef.current,
                [field]: Array.isArray(errors) ? errors : [errors]
            });
        },
        [setFormErrors, formErrorsRef]
    );

    /**
     * Remove validation errors for a specific field
     *
     * @param field
     */
    const clearFieldError = useCallback(
        (field: keyof T) => {
            const { [field]: _removed, ...rest } = formErrorsRef.current;
            setFormErrors(rest as Partial<Record<keyof T, string[]>>);
        },
        [setFormErrors, formErrorsRef]
    );

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

        const result = schema.safeParse(formRef.current);

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
    }, [schema, setFormErrors, formRef]);

    /**
     * Validate (optionally) and then call the provided submit handler.
     * Sets {@link isSubmitting} for the duration of the async operation.
     *
     * @param onSubmit       - handler called with the current form value
     * @param withValidation - when true (default) the form is validated first
     * @returns true on success, false when validation failed
     */
    const handleSubmit = useCallback(
        async (
            onSubmit: (data: T) => Promise<void> | void,
            withValidation = true
        ): Promise<boolean> => {
            if (withValidation && !validate()) return false;

            setIsSubmitting(true);
            try {
                await onSubmit(formRef.current);
                return true;
            } finally {
                setIsSubmitting(false);
            }
        },
        [validate, setIsSubmitting, formRef]
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
    const activateAutoHydrate = useCallback(
        (item: T | undefined | null) => {
            if (!item) return;
            // Compared by value, not identity: a re-fetch that resolves to an
            // equal record produces a new object every time, and re-hydrating on
            // that would wipe whatever the user has typed since. JSON is the same
            // comparison isDirty already uses.
            const fingerprint = JSON.stringify(item);
            if (hydratedFromRef.current === fingerprint) return;
            hydratedFromRef.current = fingerprint;
            setInitialFormData({ ...item });
            setFormValue({ ...item });
            setFormErrors({});
        },
        [setInitialFormData, setFormValue, setFormErrors]
    );

    return {
        get form() {
            return formRef.current;
        },
        get formErrors() {
            return formErrorsRef.current;
        },
        get showFormErrors() {
            return showFormErrorsRef.current;
        },
        setShowFormErrors,
        get isSubmitting() {
            return isSubmittingRef.current;
        },
        /**
         * True when there are no validation errors
         */
        get isValid() {
            return Object.keys(formErrorsRef.current).length === 0;
        },
        /**
         * True when the form data differs from the initial values
         */
        get isDirty() {
            return JSON.stringify(formRef.current) !== JSON.stringify(initialFormDataRef.current);
        },
        setForm,
        resetForm,
        setInitialData,
        activateAutoHydrate,
        clearErrors,
        setFieldError,
        clearFieldError,
        validate,
        handleSubmit
    };
};
