import { act, renderHook } from '@testing-library/react';
import { z } from 'zod';
import { useStructureFormValidation } from '../src/hooks/structureFormValidation';

interface ILoginForm {
    email: string;
    password: string;
}

const loginSchema = z.object({
    email: z.string().email('Invalid email address'),
    password: z.string().min(8, 'Password must be at least 8 characters')
});

const INITIAL_LOGIN: ILoginForm = { email: '', password: '' };

const createRef = <T>(getter: () => T) =>
    Object.defineProperty({}, 'value', {
        get: getter,
        enumerable: true
    }) as { value: T };

describe('useStructureFormValidation', () => {
    const mount = () => {
        const rendered = renderHook(() => useStructureFormValidation<ILoginForm>(INITIAL_LOGIN, loginSchema));
        const current = () => rendered.result.current;

        return {
            form: createRef(() => current().form),
            formErrors: createRef(() => current().formErrors),
            isSubmitting: createRef(() => current().isSubmitting),
            isValid: createRef(() => current().isValid),
            isDirty: createRef(() => current().isDirty),
            setForm: (data: Partial<ILoginForm>) => act(() => current().setForm(data)),
            resetForm: () => act(() => current().resetForm()),
            clearErrors: () => act(() => current().clearErrors()),
            setFieldError: (field: keyof ILoginForm, errors: string | string[]) =>
                act(() => current().setFieldError(field, errors)),
            clearFieldError: (field: keyof ILoginForm) => act(() => current().clearFieldError(field)),
            validate: () => {
                let ok = false;
                act(() => {
                    ok = current().validate();
                });
                return ok;
            },
            handleSubmit: async (
                onSubmit: (data: ILoginForm) => Promise<void> | void,
                withValidation = true
            ) => {
                let result = false;
                await act(async () => {
                    result = await current().handleSubmit(onSubmit, withValidation);
                });
                return result;
            }
        };
    };

    let composable: ReturnType<typeof mount>;

    beforeEach(() => {
        composable = mount();
    });

    describe('form (reactive ref)', () => {
        it('initialises with the provided initial data', () => {
            expect(composable.form.value).toEqual(INITIAL_LOGIN);
        });

        it('is independent of the initial data object (deep copy)', () => {
            composable.setForm({ email: 'mutated@test.com' });
            expect(INITIAL_LOGIN.email).toBe('');
        });
    });

    describe('setForm', () => {
        it('merges partial data into the form', () => {
            composable.setForm({ email: 'john@example.com' });
            expect(composable.form.value.email).toBe('john@example.com');
            expect(composable.form.value.password).toBe('');
        });

        it('overwrites existing fields', () => {
            composable.setForm({ email: 'a@a.com' });
            composable.setForm({ email: 'b@b.com' });
            expect(composable.form.value.email).toBe('b@b.com');
        });
    });

    describe('resetForm', () => {
        it('restores form to initial data', () => {
            composable.setForm({ email: 'changed@test.com', password: 'hunter2' });
            composable.resetForm();
            expect(composable.form.value).toEqual(INITIAL_LOGIN);
        });

        it('clears all errors on reset', () => {
            composable.setFieldError('email', 'bad email');
            composable.resetForm();
            expect(composable.formErrors.value).toEqual({});
        });
    });

    describe('isDirty', () => {
        it('is false when form matches initial data', () => {
            expect(composable.isDirty.value).toBe(false);
        });

        it('is true after a field is modified', () => {
            composable.setForm({ email: 'dirty@test.com' });
            expect(composable.isDirty.value).toBe(true);
        });

        it('returns to false after reset', () => {
            composable.setForm({ email: 'dirty@test.com' });
            composable.resetForm();
            expect(composable.isDirty.value).toBe(false);
        });
    });

    describe('isValid', () => {
        it('is true when there are no errors', () => {
            expect(composable.isValid.value).toBe(true);
        });

        it('is false after a field error is set', () => {
            composable.setFieldError('email', 'Invalid email');
            expect(composable.isValid.value).toBe(false);
        });

        it('returns to true after clearing errors', () => {
            composable.setFieldError('email', 'Invalid email');
            composable.clearErrors();
            expect(composable.isValid.value).toBe(true);
        });
    });

    describe('setFieldError / clearFieldError', () => {
        it('sets a single error message for a field', () => {
            composable.setFieldError('email', 'Required');
            expect(composable.formErrors.value.email).toEqual(['Required']);
        });

        it('sets multiple error messages for a field', () => {
            composable.setFieldError('password', ['Too short', 'No uppercase']);
            expect(composable.formErrors.value.password).toEqual(['Too short', 'No uppercase']);
        });

        it('clears only the specified field error', () => {
            composable.setFieldError('email', 'bad');
            composable.setFieldError('password', 'weak');
            composable.clearFieldError('email');
            expect(composable.formErrors.value.email).toBeUndefined();
            expect(composable.formErrors.value.password).toEqual(['weak']);
        });
    });

    describe('clearErrors', () => {
        it('removes all field errors', () => {
            composable.setFieldError('email', 'bad');
            composable.setFieldError('password', 'weak');
            composable.clearErrors();
            expect(composable.formErrors.value).toEqual({});
        });
    });

    describe('validate (with schema)', () => {
        it('returns false and populates errors when form is invalid', () => {
            const ok = composable.validate();
            expect(ok).toBe(false);
            expect(composable.formErrors.value.email).toBeDefined();
            expect(composable.formErrors.value.password).toBeDefined();
        });

        it('returns true and clears errors when form is valid', () => {
            composable.setForm({ email: 'valid@test.com', password: 'securePassword' });
            const ok = composable.validate();
            expect(ok).toBe(true);
            expect(composable.formErrors.value).toEqual({});
        });

        it('surfaces the correct zod error messages', () => {
            composable.setForm({ email: 'not-an-email', password: 'short' });
            composable.validate();
            expect(composable.formErrors.value.email).toContain('Invalid email address');
            expect(composable.formErrors.value.password).toContain(
                'Password must be at least 8 characters'
            );
        });

        it('clears previous errors after a successful validation', () => {
            composable.validate();
            expect(composable.isValid.value).toBe(false);
            composable.setForm({ email: 'valid@test.com', password: 'goodPassword' });
            composable.validate();
            expect(composable.formErrors.value).toEqual({});
        });
    });

    describe('validate (without schema)', () => {
        it('always returns true when no schema is provided', () => {
            const noSchemaComposable = renderHook(() => useStructureFormValidation<ILoginForm>(INITIAL_LOGIN));
            let ok = false;
            act(() => {
                ok = noSchemaComposable.result.current.validate();
            });
            expect(ok).toBe(true);
            expect(noSchemaComposable.result.current.formErrors).toEqual({});
        });
    });

    describe('handleSubmit', () => {
        it('does not call the handler when validation fails', async () => {
            const handler = jest.fn();
            const result = await composable.handleSubmit(handler);
            expect(result).toBe(false);
            expect(handler).not.toHaveBeenCalled();
        });

        it('calls the handler with form data when validation passes', async () => {
            composable.setForm({ email: 'valid@test.com', password: 'validPassword' });
            const handler = jest.fn().mockImplementation(async () => {});
            const result = await composable.handleSubmit(handler);
            expect(result).toBe(true);
            expect(handler).toHaveBeenCalledWith({
                email: 'valid@test.com',
                password: 'validPassword'
            });
        });

        it('sets isSubmitting to true during the handler and false afterwards', async () => {
            composable.setForm({ email: 'valid@test.com', password: 'validPassword' });
            let capturedSubmitting = false;
            const handler = jest.fn().mockImplementation(async () => {
                capturedSubmitting = true;
            });
            await composable.handleSubmit(handler);
            expect(capturedSubmitting).toBe(true);
            expect(composable.isSubmitting.value).toBe(false);
        });

        it('resets isSubmitting to false even if the handler throws', async () => {
            composable.setForm({ email: 'valid@test.com', password: 'validPassword' });
            const handler = jest.fn().mockRejectedValue(new Error('network error'));
            await expect(composable.handleSubmit(handler)).rejects.toThrow('network error');
            expect(composable.isSubmitting.value).toBe(false);
        });

        it('skips validation when withValidation is false', async () => {
            const handler = jest.fn().mockImplementation(async () => {});
            const result = await composable.handleSubmit(handler, false);
            expect(result).toBe(true);
            expect(handler).toHaveBeenCalled();
        });
    });
});
