import { renderHook, act } from '@testing-library/react';
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

describe('useStructureFormValidation', () => {
    // ─── form reactive state ──────────────────────────────────────────────

    describe('form (reactive state)', () => {
        it('initialises with the provided initial data', () => {
            const { result } = renderHook(() =>
                useStructureFormValidation<ILoginForm>(INITIAL_LOGIN, loginSchema)
            );
            expect(result.current.form).toEqual(INITIAL_LOGIN);
        });

        it('is independent of the initial data object (deep copy)', () => {
            const { result } = renderHook(() =>
                useStructureFormValidation<ILoginForm>(INITIAL_LOGIN, loginSchema)
            );
            (result.current.form as any).email = 'mutated@test.com';
            expect(INITIAL_LOGIN.email).toBe('');
        });
    });

    // ─── setForm ──────────────────────────────────────────────────────────

    describe('setForm', () => {
        it('merges partial data into the form', () => {
            const { result } = renderHook(() =>
                useStructureFormValidation<ILoginForm>(INITIAL_LOGIN, loginSchema)
            );
            act(() => {
                result.current.setForm({ email: 'john@example.com' });
            });
            expect(result.current.form.email).toBe('john@example.com');
            expect(result.current.form.password).toBe('');
        });

        it('overwrites existing fields', () => {
            const { result } = renderHook(() =>
                useStructureFormValidation<ILoginForm>(INITIAL_LOGIN, loginSchema)
            );
            act(() => {
                result.current.setForm({ email: 'a@a.com' });
                result.current.setForm({ email: 'b@b.com' });
            });
            expect(result.current.form.email).toBe('b@b.com');
        });
    });

    // ─── resetForm ────────────────────────────────────────────────────────

    describe('resetForm', () => {
        it('restores form to initial data', () => {
            const { result } = renderHook(() =>
                useStructureFormValidation<ILoginForm>(INITIAL_LOGIN, loginSchema)
            );
            act(() => {
                result.current.setForm({ email: 'changed@test.com', password: 'hunter2' });
                result.current.resetForm();
            });
            expect(result.current.form).toEqual(INITIAL_LOGIN);
        });

        it('clears all errors on reset', () => {
            const { result } = renderHook(() =>
                useStructureFormValidation<ILoginForm>(INITIAL_LOGIN, loginSchema)
            );
            act(() => {
                result.current.setFieldError('email', 'bad email');
                result.current.resetForm();
            });
            expect(result.current.formErrors).toEqual({});
        });
    });

    // ─── setInitialData ───────────────────────────────────────────────────

    describe('setInitialData', () => {
        it('changes the baseline resetForm() restores to', () => {
            const { result } = renderHook(() =>
                useStructureFormValidation<ILoginForm>(INITIAL_LOGIN, loginSchema)
            );
            act(() => {
                result.current.setInitialData({ email: 'fetched@test.com', password: 'fetchedPass' });
                result.current.setForm({ email: 'edited@test.com' });
                result.current.resetForm();
            });
            expect(result.current.form).toEqual({
                email: 'fetched@test.com',
                password: 'fetchedPass'
            });
        });

        it('does not itself touch the live form value', () => {
            const { result } = renderHook(() =>
                useStructureFormValidation<ILoginForm>(INITIAL_LOGIN, loginSchema)
            );
            act(() => {
                result.current.setInitialData({ email: 'fetched@test.com', password: 'fetchedPass' });
            });
            expect(result.current.form).toEqual(INITIAL_LOGIN);
        });

        it('shifts isDirty comparison baseline', () => {
            const { result } = renderHook(() =>
                useStructureFormValidation<ILoginForm>(INITIAL_LOGIN, loginSchema)
            );
            act(() => {
                result.current.setForm({ email: 'same@test.com', password: 'samePass' });
                result.current.setInitialData({ email: 'same@test.com', password: 'samePass' });
            });
            expect(result.current.isDirty).toBe(false);
        });
    });

    // ─── activateAutoHydrate ──────────────────────────────────────────────

    describe('activateAutoHydrate', () => {
        it('does nothing while the source is undefined', () => {
            const { result } = renderHook(() =>
                useStructureFormValidation<ILoginForm>(INITIAL_LOGIN, loginSchema)
            );
            // In React, activateAutoHydrate accepts a plain value (not a ref)
            result.current.activateAutoHydrate(undefined);
            expect(result.current.form).toEqual(INITIAL_LOGIN);
            expect(result.current.isDirty).toBe(false);
        });

        it('adopts the source as the new baseline as soon as it resolves', async () => {
            const { result, rerender } = renderHook(
                ({ source }: { source?: ILoginForm }) => {
                    const c = useStructureFormValidation<ILoginForm>(INITIAL_LOGIN, loginSchema);
                    c.activateAutoHydrate(source);
                    return c;
                },
                { initialProps: { source: undefined as ILoginForm | undefined } }
            );

            await act(async () => {
                rerender({ source: { email: 'hydrated@test.com', password: 'hydratedPass' } });
            });

            expect(result.current.form).toEqual({
                email: 'hydrated@test.com',
                password: 'hydratedPass'
            });
            expect(result.current.isDirty).toBe(false);
        });

        it('keeps hydrating the form on later source changes, discarding local edits', async () => {
            const { result, rerender } = renderHook(
                ({ source }: { source?: ILoginForm }) => {
                    const c = useStructureFormValidation<ILoginForm>(INITIAL_LOGIN, loginSchema);
                    c.activateAutoHydrate(source);
                    return c;
                },
                {
                    initialProps: {
                        source: { email: 'first@test.com', password: 'firstPass' }
                    }
                }
            );

            await act(async () => {
                rerender({ source: { email: 'first@test.com', password: 'firstPass' } });
            });

            act(() => {
                result.current.setForm({ email: 'locallyEdited@test.com' });
            });

            await act(async () => {
                rerender({ source: { email: 'second@test.com', password: 'secondPass' } });
            });

            expect(result.current.form).toEqual({
                email: 'second@test.com',
                password: 'secondPass'
            });
        });
    });

    // ─── isDirty ──────────────────────────────────────────────────────────

    describe('isDirty', () => {
        it('is false when form matches initial data', () => {
            const { result } = renderHook(() =>
                useStructureFormValidation<ILoginForm>(INITIAL_LOGIN, loginSchema)
            );
            expect(result.current.isDirty).toBe(false);
        });

        it('is true after a field is modified', () => {
            const { result } = renderHook(() =>
                useStructureFormValidation<ILoginForm>(INITIAL_LOGIN, loginSchema)
            );
            act(() => {
                result.current.setForm({ email: 'dirty@test.com' });
            });
            expect(result.current.isDirty).toBe(true);
        });

        it('returns to false after reset', () => {
            const { result } = renderHook(() =>
                useStructureFormValidation<ILoginForm>(INITIAL_LOGIN, loginSchema)
            );
            act(() => {
                result.current.setForm({ email: 'dirty@test.com' });
                result.current.resetForm();
            });
            expect(result.current.isDirty).toBe(false);
        });
    });

    // ─── isValid ──────────────────────────────────────────────────────────

    describe('isValid', () => {
        it('is true when there are no errors', () => {
            const { result } = renderHook(() =>
                useStructureFormValidation<ILoginForm>(INITIAL_LOGIN, loginSchema)
            );
            expect(result.current.isValid).toBe(true);
        });

        it('is false after a field error is set', () => {
            const { result } = renderHook(() =>
                useStructureFormValidation<ILoginForm>(INITIAL_LOGIN, loginSchema)
            );
            act(() => {
                result.current.setFieldError('email', 'Invalid email');
            });
            expect(result.current.isValid).toBe(false);
        });

        it('returns to true after clearing errors', () => {
            const { result } = renderHook(() =>
                useStructureFormValidation<ILoginForm>(INITIAL_LOGIN, loginSchema)
            );
            act(() => {
                result.current.setFieldError('email', 'Invalid email');
                result.current.clearErrors();
            });
            expect(result.current.isValid).toBe(true);
        });
    });

    // ─── setFieldError / clearFieldError ──────────────────────────────────

    describe('setFieldError / clearFieldError', () => {
        it('sets a single error message for a field', () => {
            const { result } = renderHook(() =>
                useStructureFormValidation<ILoginForm>(INITIAL_LOGIN, loginSchema)
            );
            act(() => {
                result.current.setFieldError('email', 'Required');
            });
            expect(result.current.formErrors.email).toEqual(['Required']);
        });

        it('sets multiple error messages for a field', () => {
            const { result } = renderHook(() =>
                useStructureFormValidation<ILoginForm>(INITIAL_LOGIN, loginSchema)
            );
            act(() => {
                result.current.setFieldError('password', ['Too short', 'No uppercase']);
            });
            expect(result.current.formErrors.password).toEqual(['Too short', 'No uppercase']);
        });

        it('clears only the specified field error', () => {
            const { result } = renderHook(() =>
                useStructureFormValidation<ILoginForm>(INITIAL_LOGIN, loginSchema)
            );
            act(() => {
                result.current.setFieldError('email', 'bad');
                result.current.setFieldError('password', 'weak');
                result.current.clearFieldError('email');
            });
            expect(result.current.formErrors.email).toBeUndefined();
            expect(result.current.formErrors.password).toEqual(['weak']);
        });
    });

    // ─── clearErrors ──────────────────────────────────────────────────────

    describe('clearErrors', () => {
        it('removes all field errors', () => {
            const { result } = renderHook(() =>
                useStructureFormValidation<ILoginForm>(INITIAL_LOGIN, loginSchema)
            );
            act(() => {
                result.current.setFieldError('email', 'bad');
                result.current.setFieldError('password', 'weak');
                result.current.clearErrors();
            });
            expect(result.current.formErrors).toEqual({});
        });
    });

    // ─── validate (with schema) ───────────────────────────────────────────

    describe('validate (with schema)', () => {
        it('returns false and populates errors when form is invalid', () => {
            const { result } = renderHook(() =>
                useStructureFormValidation<ILoginForm>(INITIAL_LOGIN, loginSchema)
            );
            let ok = false;
            act(() => {
                ok = result.current.validate();
            });
            expect(ok).toBe(false);
            expect(result.current.formErrors.email).toBeDefined();
            expect(result.current.formErrors.password).toBeDefined();
        });

        it('returns true and clears errors when form is valid', () => {
            const { result } = renderHook(() =>
                useStructureFormValidation<ILoginForm>(INITIAL_LOGIN, loginSchema)
            );
            act(() => {
                result.current.setForm({ email: 'valid@test.com', password: 'securePassword' });
            });
            let ok = false;
            act(() => {
                ok = result.current.validate();
            });
            expect(ok).toBe(true);
            expect(result.current.formErrors).toEqual({});
        });

        it('surfaces the correct zod error messages', () => {
            const { result } = renderHook(() =>
                useStructureFormValidation<ILoginForm>(INITIAL_LOGIN, loginSchema)
            );
            act(() => {
                result.current.setForm({ email: 'not-an-email', password: 'short' });
                result.current.validate();
            });
            expect(result.current.formErrors.email).toContain('Invalid email address');
            expect(result.current.formErrors.password).toContain(
                'Password must be at least 8 characters'
            );
        });

        it('clears previous errors after a successful validation', () => {
            const { result } = renderHook(() =>
                useStructureFormValidation<ILoginForm>(INITIAL_LOGIN, loginSchema)
            );
            act(() => {
                result.current.validate();
            });
            expect(result.current.isValid).toBe(false);

            act(() => {
                result.current.setForm({ email: 'valid@test.com', password: 'goodPassword' });
                result.current.validate();
            });
            expect(result.current.formErrors).toEqual({});
        });
    });

    // ─── validate (without schema) ────────────────────────────────────────

    describe('validate (without schema)', () => {
        it('always returns true when no schema is provided', () => {
            const { result } = renderHook(() =>
                useStructureFormValidation<ILoginForm>(INITIAL_LOGIN)
            );
            let ok = false;
            act(() => {
                ok = result.current.validate();
            });
            expect(ok).toBe(true);
            expect(result.current.formErrors).toEqual({});
        });
    });

    // ─── handleSubmit ────────────────────────────────────────────────────

    describe('handleSubmit', () => {
        it('does not call the handler when validation fails', async () => {
            const { result } = renderHook(() =>
                useStructureFormValidation<ILoginForm>(INITIAL_LOGIN, loginSchema)
            );
            const handler = jest.fn();
            const resultVal = await result.current.handleSubmit(handler);
            expect(resultVal).toBe(false);
            expect(handler).not.toHaveBeenCalled();
        });

        it('calls the handler with form data when validation passes', async () => {
            const { result } = renderHook(() =>
                useStructureFormValidation<ILoginForm>(INITIAL_LOGIN, loginSchema)
            );
            act(() => {
                result.current.setForm({ email: 'valid@test.com', password: 'validPassword' });
            });
            const handler = jest.fn();
            const resultVal = await result.current.handleSubmit(handler);
            expect(resultVal).toBe(true);
            expect(handler).toHaveBeenCalledWith({
                email: 'valid@test.com',
                password: 'validPassword'
            });
        });

        it('sets isSubmitting to true during the handler and false afterwards', async () => {
            const { result } = renderHook(() =>
                useStructureFormValidation<ILoginForm>(INITIAL_LOGIN, loginSchema)
            );
            act(() => {
                result.current.setForm({ email: 'valid@test.com', password: 'validPassword' });
            });
            let capturedSubmitting = false;
            const handler = jest.fn(() => {
                capturedSubmitting = result.current.isSubmitting;
            });
            await result.current.handleSubmit(handler);
            expect(capturedSubmitting).toBe(true);
            expect(result.current.isSubmitting).toBe(false);
        });

        it('resets isSubmitting to false even if the handler throws', async () => {
            const { result } = renderHook(() =>
                useStructureFormValidation<ILoginForm>(INITIAL_LOGIN, loginSchema)
            );
            act(() => {
                result.current.setForm({ email: 'valid@test.com', password: 'validPassword' });
            });
            const handler = jest.fn().mockRejectedValue(new Error('network error'));
            await expect(result.current.handleSubmit(handler)).rejects.toThrow('network error');
            expect(result.current.isSubmitting).toBe(false);
        });

        it('skips validation when withValidation is false', async () => {
            const { result } = renderHook(() =>
                useStructureFormValidation<ILoginForm>(INITIAL_LOGIN, loginSchema)
            );
            const handler = jest.fn();
            const resultVal = await result.current.handleSubmit(handler, false);
            expect(resultVal).toBe(true);
            expect(handler).toHaveBeenCalled();
        });
    });
});