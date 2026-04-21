import { computed, ref } from '../reactivity';
import { type ZodType } from 'zod';

/**
 * Form management composable.
 * Handles reactive form state, optional Zod schema validation and submission flow.
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
     * Reactive form data
     */
    const form = ref<T>({ ...initialData } as T);

    /**
     * Per-field validation errors.
     * Each key maps to a list of error messages for that field.
     */
    const formErrors = ref<Partial<Record<keyof T, string[]>>>({});

    /**
     * Whether a submission is currently in progress
     */
    const isSubmitting = ref(false);

    /**
     * True when there are no validation errors
     */
    const isValid = computed(() => Object.keys(formErrors.value).length === 0);

    /**
     * True when the form data differs from the initial values
     */
    const isDirty = computed(() => JSON.stringify(form.value) !== JSON.stringify(initialData));

    /**
     * Merge partial data into the form
     *
     * @param data
     */
    const setForm = (data: Partial<T>) => {
        form.value = { ...form.value, ...data } as T;
    };

    /**
     * Reset form to initial values and clear all errors
     */
    const resetForm = () => {
        form.value = { ...initialData } as T;
        formErrors.value = {};
    };

    /**
     * Clear all validation errors
     */
    const clearErrors = () => {
        formErrors.value = {};
    };

    /**
     * Set validation error(s) for a specific field
     *
     * @param field
     * @param errors - a single message or an array of messages
     */
    const setFieldError = (field: keyof T, errors: string | string[]) => {
        formErrors.value = {
            ...formErrors.value,
            [field]: Array.isArray(errors) ? errors : [errors]
        };
    };

    /**
     * Remove validation errors for a specific field
     *
     * @param field
     */
    const clearFieldError = (field: keyof T) => {
        const { [field]: _removed, ...rest } = formErrors.value;
        formErrors.value = rest as Partial<Record<keyof T, string[]>>;
    };

    /**
     * Validate the current form value against the schema (if provided).
     * Updates {@link formErrors} reactively.
     *
     * @returns true when validation passes (or no schema is set), false otherwise
     */
    const validate = (): boolean => {
        if (!schema) {
            formErrors.value = {};
            return true;
        }

        const result = schema.safeParse(form.value);

        if (result.success) {
            formErrors.value = {};
            return true;
        }

        const errors: Partial<Record<keyof T, string[]>> = {};
        for (const issue of result.error.issues) {
            const field = issue.path[0] as keyof T;
            if (field === undefined) continue;
            if (!errors[field]) errors[field] = [];
            errors[field]!.push(issue.message);
        }
        formErrors.value = errors;

        return false;
    };

    /**
     * Validate (optionally) and then call the provided submit handler.
     * Sets {@link isSubmitting} for the duration of the async operation.
     *
     * @param onSubmit       - handler called with the current form value
     * @param withValidation - when true (default) the form is validated first
     * @returns true on success, false when validation failed or an error was thrown
     */
    const handleSubmit = async (
        onSubmit: (data: T) => Promise<void> | void,
        withValidation = true
    ): Promise<boolean> => {
        if (withValidation && !validate()) return false;

        isSubmitting.value = true;
        try {
            await onSubmit(form.value);
            return true;
        } finally {
            isSubmitting.value = false;
        }
    };

    return {
        form,
        formErrors,
        isSubmitting,
        isValid,
        isDirty,
        setForm,
        resetForm,
        clearErrors,
        setFieldError,
        clearFieldError,
        validate,
        handleSubmit
    };
};
