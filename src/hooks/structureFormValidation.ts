import { useMemo, useState } from 'react';
import { type ZodType } from 'zod';

/**
 * Form management hook.
 * Handles stateful form data, optional Zod schema validation and submit flow.
 *
 * @param initialData - Initial values for form fields
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
     * Form data
     */
    const [form, setFormState] = useState<T>({ ...initialData } as T);
    /**
     * Per-field validation errors.
     * Each key maps to an array of error messages for that field.
     */
    const [formErrors, setFormErrors] = useState<Partial<Record<keyof T, string[]>>>({});
    /**
     * Whether a submission is currently running
     */
    const [isSubmitting, setIsSubmitting] = useState(false);

    /**
     * True when there are no validation errors
     */
    const isValid = useMemo(() => Object.keys(formErrors).length === 0, [formErrors]);
    /**
     * True when form data differs from the initial values
     */
    const isDirty = useMemo(() => JSON.stringify(form) !== JSON.stringify(initialData), [form, initialData]);

    /**
     * Merge partial data into the form
     *
     * @param data
     */
    const setForm = (data: Partial<T>) => {
        setFormState((previous) => ({ ...previous, ...data } as T));
    };

    /**
     * Reset form to initial values and clear all errors
     */
    const resetForm = () => {
        setFormState({ ...initialData } as T);
        setFormErrors({});
    };

    /**
     * Clear all validation errors
     */
    const clearErrors = () => {
        setFormErrors({});
    };

    /**
     * Set validation error(s) for a specific field
     *
     * @param field
     * @param errors - a single message or an array of messages
     */
    const setFieldError = (field: keyof T, errors: string | string[]) => {
        setFormErrors((previous) => ({
            ...previous,
            [field]: Array.isArray(errors) ? errors : [errors]
        }));
    };

    /**
     * Remove validation errors for a specific field
     *
     * @param field
     */
    const clearFieldError = (field: keyof T) => {
        setFormErrors((previous) => {
            const { [field]: _removed, ...rest } = previous;
            return rest as Partial<Record<keyof T, string[]>>;
        });
    };

    /**
     * Validate the current form value against the schema (if provided).
     *
     * @returns true when validation passes (or no schema is set), false otherwise
     */
    const validate = (): boolean => {
        if (!schema) {
            setFormErrors({});
            return true;
        }

        const result = schema.safeParse(form);

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
    };

    /**
     * Validate (optionally) and then call the submit handler.
     *
     * @param onSubmit       - callback called with current form data
     * @param withValidation - when true (default) validates first
     * @returns true on success, false when validation failed
     */
    const handleSubmit = async (
        onSubmit: (data: T) => Promise<void> | void,
        withValidation = true
    ): Promise<boolean> => {
        if (withValidation && !validate()) return false;

        setIsSubmitting(true);
        try {
            await onSubmit(form);
            return true;
        } finally {
            setIsSubmitting(false);
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
