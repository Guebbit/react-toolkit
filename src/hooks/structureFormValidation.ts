import { useCallback, useRef, useState } from 'react';
import { type ZodType } from 'zod';

/**
 * Form management custom hook.
 * Handles reactive form state, optional Zod schema validation and submission flow.
 *
 * @param initialData - Initial values for the form fields
 * @param schema      - Optional Zod schema used for validation, or a factory
 *                      returning one (e.g. `() => createUsersSchema(t)`). Use
 *                      the factory form when the schema's messages depend on
 *                      i18n, so a language change is picked up on the next
 *                      validate() instead of being frozen at hook-creation time.
 */
export const useStructureFormValidation = <
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    T extends Record<string, any> = Record<string, any>
>(
    initialData: T = {} as T,
    schema?: ZodType<T> | (() => ZodType<T>)
) => {
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
     * Whether the UI should surface {@link formErrors} yet — typically flipped on
     * after the first submit attempt, so a pristine form isn't shown as invalid.
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

            isSubmittingRef.current = true;
            setIsSubmittingState(true);
            try {
                await onSubmit(formRef.current);
                return true;
            } finally {
                isSubmittingRef.current = false;
                setIsSubmittingState(false);
            }
        },
        [validate]
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
        validate,
        handleSubmit
    };
};
