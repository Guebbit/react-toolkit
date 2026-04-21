import { useMemo, useState } from 'react';
import { type ZodType } from 'zod';

export const useStructureFormValidation = <
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    T extends Record<string, any> = Record<string, any>
>(
    initialData: T = {} as T,
    schema?: ZodType<T>
) => {
    const [form, setFormState] = useState<T>({ ...initialData } as T);
    const [formErrors, setFormErrors] = useState<Partial<Record<keyof T, string[]>>>({});
    const [isSubmitting, setIsSubmitting] = useState(false);

    const isValid = useMemo(() => Object.keys(formErrors).length === 0, [formErrors]);
    const isDirty = useMemo(() => JSON.stringify(form) !== JSON.stringify(initialData), [form, initialData]);

    const setForm = (data: Partial<T>) => {
        setFormState((previous) => ({ ...previous, ...data } as T));
    };

    const resetForm = () => {
        setFormState({ ...initialData } as T);
        setFormErrors({});
    };

    const clearErrors = () => {
        setFormErrors({});
    };

    const setFieldError = (field: keyof T, errors: string | string[]) => {
        setFormErrors((previous) => ({
            ...previous,
            [field]: Array.isArray(errors) ? errors : [errors]
        }));
    };

    const clearFieldError = (field: keyof T) => {
        setFormErrors((previous) => {
            const { [field]: _removed, ...rest } = previous;
            return rest as Partial<Record<keyof T, string[]>>;
        });
    };

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
