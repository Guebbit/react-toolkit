import { renderHook, act } from '@testing-library/react';
import { z } from 'zod';
import {
    useStructureFormValidation,
    type IFieldContainer,
    type IStructureFormValidationOptions
} from '../src/hooks/structureFormValidation';

interface ILoginForm {
    email: string;
    password: string;
}

const loginSchema = z.object({
    email: z.string().email('Invalid email address'),
    password: z.string().min(8, 'Password must be at least 8 characters')
});

const INITIAL_LOGIN: ILoginForm = { email: '', password: '' };

/**
 * Stand-in for the form element: the hook only ever asks it for a descendant and tries to focus
 * what comes back, so a container and a field are all a test needs.
 */
const createForm = (field?: unknown) => ({
    querySelector: jest.fn().mockReturnValue(field)
});

/**
 * The hook under the default login schema, returned as the live `result` so every assertion
 * reads through the latest render.
 */
const makeForm = (options: IStructureFormValidationOptions<ILoginForm> = {}) => {
    const { result } = renderHook(() =>
        useStructureFormValidation<ILoginForm>(INITIAL_LOGIN, loginSchema, options)
    );
    return result;
};

/**
 * A login schema whose email message is a thunk, so the wording is decided at parse time.
 */
const localizedSchema = (message: () => string) =>
    z.object({
        email: z.string().email({ error: message }),
        password: z.string()
    });

/** Applies a rejection through act() and hands back what it returned. */
const apply = (
    form: ReturnType<typeof makeForm>,
    error: unknown,
    options?: Parameters<typeof form.current.applyServerErrors>[1]
) => {
    let applied: boolean | undefined;
    act(() => {
        applied = form.current.applyServerErrors(error, options);
    });
    return applied;
};

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
            result.current.form.email = 'mutated@test.com';
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
                result.current.setInitialData({
                    email: 'fetched@test.com',
                    password: 'fetchedPass'
                });
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
                result.current.setInitialData({
                    email: 'fetched@test.com',
                    password: 'fetchedPass'
                });
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
            result.current.activateAutoHydrate();
            expect(result.current.form).toEqual(INITIAL_LOGIN);
            expect(result.current.isDirty).toBe(false);
        });

        it('adopts the source as the new baseline as soon as it resolves', () => {
            const { result, rerender } = renderHook(
                ({ source }: { source?: ILoginForm }) => {
                    const c = useStructureFormValidation<ILoginForm>(INITIAL_LOGIN, loginSchema);
                    c.activateAutoHydrate(source);
                    return c;
                },
                { initialProps: { source: undefined as ILoginForm | undefined } }
            );

            act(() => {
                rerender({ source: { email: 'hydrated@test.com', password: 'hydratedPass' } });
            });

            expect(result.current.form).toEqual({
                email: 'hydrated@test.com',
                password: 'hydratedPass'
            });
            expect(result.current.isDirty).toBe(false);
        });

        it('keeps hydrating the form on later source changes, discarding local edits', () => {
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

            act(() => {
                rerender({ source: { email: 'first@test.com', password: 'firstPass' } });
            });

            act(() => {
                result.current.setForm({ email: 'locallyEdited@test.com' });
            });

            act(() => {
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
            let resultVal: boolean | undefined;
            await act(async () => {
                resultVal = await result.current.handleSubmit(handler);
            });
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
            let resultVal: boolean | undefined;
            await act(async () => {
                resultVal = await result.current.handleSubmit(handler);
            });
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
            await act(async () => {
                await result.current.handleSubmit(handler);
            });
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
            await expect(
                act(async () => {
                    await result.current.handleSubmit(handler);
                })
            ).rejects.toThrow('network error');
            expect(result.current.isSubmitting).toBe(false);
        });

        it('skips validation when withValidation is false', async () => {
            const { result } = renderHook(() =>
                useStructureFormValidation<ILoginForm>(INITIAL_LOGIN, loginSchema)
            );
            const handler = jest.fn();
            let resultVal: boolean | undefined;
            await act(async () => {
                resultVal = await result.current.handleSubmit(handler, false);
            });
            expect(resultVal).toBe(true);
            expect(handler).toHaveBeenCalled();
        });

        // ─── showFormErrors ownership ─────────────────────────────────────────
        // The hook, not the call site, decides when errors are on screen.

        it('reveals the errors when validation rejects the submit', async () => {
            const form = makeForm();
            await act(async () => {
                await form.current.handleSubmit(jest.fn());
            });
            expect(form.current.showFormErrors).toBe(true);
        });

        it('hides the errors once a submit validates', async () => {
            const form = makeForm();
            await act(async () => {
                await form.current.handleSubmit(jest.fn());
            });
            act(() => {
                form.current.setForm({ email: 'valid@test.com', password: 'validPassword' });
            });
            await act(async () => {
                await form.current.handleSubmit(jest.fn().mockImplementation(async () => {}));
            });
            expect(form.current.showFormErrors).toBe(false);
        });

        it('leaves the errors hidden when the handler itself fails', async () => {
            // A rejected API call says nothing about any particular field, so nothing to reveal.
            const form = makeForm();
            act(() => {
                form.current.setForm({ email: 'valid@test.com', password: 'validPassword' });
            });
            const handler = jest.fn().mockRejectedValue(new Error('network error'));
            await expect(
                act(async () => {
                    await form.current.handleSubmit(handler);
                })
            ).rejects.toThrow('network error');
            expect(form.current.showFormErrors).toBe(false);
        });

        it('does not reveal anything when validation is skipped', async () => {
            const form = makeForm();
            await act(async () => {
                await form.current.handleSubmit(
                    jest.fn().mockImplementation(async () => {}),
                    false
                );
            });
            expect(form.current.showFormErrors).toBe(false);
        });
    });

    // ─── revealErrors ─────────────────────────────────────────────────────

    describe('revealErrors', () => {
        it('turns showFormErrors on', async () => {
            const form = makeForm();
            await act(async () => {
                await form.current.revealErrors();
            });
            expect(form.current.showFormErrors).toBe(true);
        });

        it('focuses the first invalid field of the given form', async () => {
            const field = { focus: jest.fn() };
            const formElement = createForm(field);
            const form = makeForm({ formElement });

            await act(async () => {
                await form.current.revealErrors();
            });

            expect(formElement.querySelector).toHaveBeenCalledWith('[aria-invalid="true"]');
            expect(field.focus).toHaveBeenCalled();
        });

        it('honours a custom selector, for kits that mark the wrapper', async () => {
            const formElement = createForm({ focus: jest.fn() });
            const form = makeForm({
                formElement,
                invalidFieldSelector: '.MuiFormControl-root .Mui-error input'
            });

            await act(async () => {
                await form.current.revealErrors();
            });

            expect(formElement.querySelector).toHaveBeenCalledWith(
                '.MuiFormControl-root .Mui-error input'
            );
        });

        it('reads the form element through a ref object, so `ref={formRef}` works', async () => {
            const field = { focus: jest.fn() };
            const formElement: { current: IFieldContainer | undefined } = { current: undefined };
            const form = makeForm({ formElement });

            // Unmounted: nothing to focus, and nothing to throw either.
            await act(async () => {
                await form.current.revealErrors();
            });
            expect(field.focus).not.toHaveBeenCalled();

            formElement.current = createForm(field);
            await act(async () => {
                await form.current.revealErrors();
            });
            expect(field.focus).toHaveBeenCalled();
        });

        it('is a pure state change when no form element was given', async () => {
            // The SSR / node-test path: no DOM is touched at all.
            const form = makeForm();
            let resolved: unknown = 'unset';
            await act(async () => {
                resolved = await form.current.revealErrors();
            });
            expect(resolved).toBeUndefined();
            expect(form.current.showFormErrors).toBe(true);
        });

        it('tolerates a match that cannot be focused', async () => {
            const form = makeForm({ formElement: createForm({ notAFocusMethod: true }) });
            let resolved: unknown = 'unset';
            await act(async () => {
                resolved = await form.current.revealErrors();
            });
            expect(resolved).toBeUndefined();
        });

        it('calls onInvalid with the errors on display', async () => {
            const onInvalid = jest.fn();
            const form = makeForm({ onInvalid });

            act(() => {
                form.current.validate();
            });
            await act(async () => {
                await form.current.revealErrors();
            });

            expect(onInvalid).toHaveBeenCalledWith(
                expect.objectContaining({ email: ['Invalid email address'] })
            );
        });

        it('is reached by a failed handleSubmit, hook and focus included', async () => {
            const field = { focus: jest.fn() };
            const onInvalid = jest.fn();
            const form = makeForm({ formElement: createForm(field), onInvalid });

            let resultVal: boolean | undefined;
            await act(async () => {
                resultVal = await form.current.handleSubmit(jest.fn());
            });

            expect(resultVal).toBe(false);
            expect(field.focus).toHaveBeenCalled();
            expect(onInvalid).toHaveBeenCalled();
        });
    });

    // ─── applyServerErrors ────────────────────────────────────────────────

    describe('applyServerErrors', () => {
        it('attaches a field map to the matching fields', () => {
            const form = makeForm();
            const applied = apply(form, {
                errors: { email: 'Already taken', password: ['Too short', 'Too common'] }
            });

            expect(applied).toBe(true);
            expect(form.current.formErrors.email).toEqual(['Already taken']);
            expect(form.current.formErrors.password).toEqual(['Too short', 'Too common']);
        });

        it('reads a list of {field, message} objects', () => {
            const form = makeForm();
            apply(form, { errors: [{ field: 'email', message: 'Already taken' }] });
            expect(form.current.formErrors.email).toEqual(['Already taken']);
        });

        it('reads express-validator’s param/msg spelling', () => {
            const form = makeForm();
            apply(form, { errors: [{ param: 'password', msg: 'Too short' }] });
            expect(form.current.formErrors.password).toEqual(['Too short']);
        });

        it('reads a zod-shaped issue list, collapsing nested paths to their root field', () => {
            const form = makeForm();
            apply(form, {
                issues: [{ path: ['email', 'domain'], message: 'Domain not allowed' }]
            });
            expect(form.current.formErrors.email).toEqual(['Domain not allowed']);
        });

        it('digs the errors out of an unwrapped body', () => {
            const form = makeForm();
            apply(form, { data: { errors: { email: 'Already taken' } } });
            expect(form.current.formErrors.email).toEqual(['Already taken']);
        });

        it('digs the errors out of a raw axios error', () => {
            const form = makeForm();
            apply(form, { response: { data: { errors: { email: 'Already taken' } } } });
            expect(form.current.formErrors.email).toEqual(['Already taken']);
        });

        it('renames server fields through the map option', () => {
            const form = makeForm();
            apply(
                form,
                { errors: { user_email: 'Already taken' } },
                { map: { user_email: 'email' } }
            );
            expect(form.current.formErrors.email).toEqual(['Already taken']);
        });

        it('routes form-level messages to onUnmapped', () => {
            const form = makeForm();
            const onUnmapped = jest.fn();
            const applied = apply(form, { errors: ['Payment declined'] }, { onUnmapped });

            expect(applied).toBe(false);
            expect(onUnmapped).toHaveBeenCalledWith(['Payment declined']);
        });

        it('routes errors about fields this form does not have to onUnmapped', () => {
            const form = makeForm();
            const onUnmapped = jest.fn();
            apply(form, { errors: { captcha: 'Expired' } }, { onUnmapped });

            expect(onUnmapped).toHaveBeenCalledWith(['Expired']);
            expect(form.current.formErrors).toEqual({});
        });

        it('splits a mixed payload between the fields and onUnmapped', () => {
            const form = makeForm();
            const onUnmapped = jest.fn();
            const applied = apply(
                form,
                { errors: [{ field: 'email', message: 'Already taken' }, 'Payment declined'] },
                { onUnmapped }
            );

            expect(applied).toBe(true);
            expect(form.current.formErrors.email).toEqual(['Already taken']);
            expect(onUnmapped).toHaveBeenCalledWith(['Payment declined']);
        });

        it('reveals what it applied', () => {
            const form = makeForm();
            expect(form.current.showFormErrors).toBe(false);
            apply(form, { errors: { email: 'Already taken' } });
            expect(form.current.showFormErrors).toBe(true);
        });

        it('keeps errors the server said nothing about', () => {
            // The API answered about `email`; that is not an all-clear for `password`.
            const form = makeForm();
            act(() => {
                form.current.setFieldError('password', 'Too short');
            });
            apply(form, { errors: { email: 'Already taken' } });

            expect(form.current.formErrors.password).toEqual(['Too short']);
            expect(form.current.formErrors.email).toEqual(['Already taken']);
        });

        it('returns false, and changes nothing, for a rejection carrying no errors', () => {
            const form = makeForm();
            const applied = apply(form, new Error('network error'));

            expect(applied).toBe(false);
            expect(form.current.formErrors).toEqual({});
            expect(form.current.showFormErrors).toBe(false);
        });

        it('ignores empty and non-string messages', () => {
            const form = makeForm();
            const applied = apply(form, {
                errors: { email: ['', undefined, 42], password: [] }
            });

            expect(applied).toBe(false);
            expect(form.current.formErrors).toEqual({});
        });
    });

    // ─── initial flags ────────────────────────────────────────────────────

    describe('initial flags', () => {
        it('showFormErrors starts false (a pristine form is not shown as invalid)', () => {
            const { result } = renderHook(() =>
                useStructureFormValidation<ILoginForm>(INITIAL_LOGIN, loginSchema)
            );
            expect(result.current.showFormErrors).toBe(false);
        });

        it('isSubmitting starts false', () => {
            const { result } = renderHook(() =>
                useStructureFormValidation<ILoginForm>(INITIAL_LOGIN, loginSchema)
            );
            expect(result.current.isSubmitting).toBe(false);
        });
    });

    // ─── validate: factory schema + multi-error accumulation ──────────────

    describe('validate — schema factory form', () => {
        // The factory form `() => schema` exists so i18n message changes are picked
        // up on the next validate(); it must be CALLED, not used as the schema object.
        it('resolves and uses a function-returning-schema', () => {
            const { result } = renderHook(() =>
                useStructureFormValidation<ILoginForm>(INITIAL_LOGIN, () => loginSchema)
            );

            // invalid to start → validate returns false and surfaces the messages
            let invalidPass: boolean | undefined;
            act(() => {
                invalidPass = result.current.validate();
            });
            expect(invalidPass).toBe(false);
            expect(result.current.formErrors.email).toContain('Invalid email address');

            act(() => {
                result.current.setForm({ email: 'valid@test.com', password: 'validPassword' });
            });
            let validPass: boolean | undefined;
            act(() => {
                validPass = result.current.validate();
            });
            expect(validPass).toBe(true);
        });
    });

    // ─── revalidateOn ─────────────────────────────────────────────────────

    /**
     * `formErrors` holds resolved strings, so nothing about the schema can re-translate an error
     * already on screen — only re-running `validate()` can. These cover the three behaviours that
     * matter: it must re-run when there is something to re-translate, must NOT run on mount, and
     * must NOT run for a form with nothing on display.
     */
    describe('revalidateOn', () => {
        it('re-translates displayed errors when the dependency changes', () => {
            const messages: Record<string, string> = {
                en: 'Invalid email address',
                it: 'Indirizzo email non valido'
            };
            let locale = 'en';

            const { result, rerender } = renderHook(() =>
                useStructureFormValidation<ILoginForm>(
                    INITIAL_LOGIN,
                    localizedSchema(() => messages[locale] ?? ''),
                    { revalidateOn: [locale] }
                )
            );

            act(() => {
                result.current.validate();
            });
            expect(result.current.formErrors.email).toContain('Invalid email address');

            locale = 'it';
            rerender();

            expect(result.current.formErrors.email).toContain('Indirizzo email non valido');
        });

        it('does not validate on mount', () => {
            const { result } = renderHook(() =>
                useStructureFormValidation<ILoginForm>(INITIAL_LOGIN, loginSchema, {
                    revalidateOn: ['en']
                })
            );

            // `useEffect` runs on mount and Vue's `watch` does not; without the mount skip this
            // would surface errors on a form the user has not touched.
            expect(result.current.formErrors).toEqual({});
            expect(result.current.isValid).toBe(true);
        });

        it('leaves a pristine form pristine when the dependency changes', () => {
            let locale = 'en';
            const { result, rerender } = renderHook(() =>
                useStructureFormValidation<ILoginForm>(INITIAL_LOGIN, loginSchema, {
                    revalidateOn: [locale]
                })
            );

            locale = 'it';
            rerender();

            expect(result.current.formErrors).toEqual({});
        });

        it('does nothing to a form that validated cleanly', () => {
            let locale = 'en';
            const { result, rerender } = renderHook(() =>
                useStructureFormValidation<ILoginForm>(INITIAL_LOGIN, loginSchema, {
                    revalidateOn: [locale]
                })
            );

            act(() => {
                result.current.setForm({ email: 'valid@test.com', password: 'validPassword' });
            });
            act(() => {
                expect(result.current.validate()).toBe(true);
            });

            locale = 'it';
            rerender();

            expect(result.current.formErrors).toEqual({});
        });

        it('is inert when no dependency list is given', () => {
            let locale = 'en';
            const { result, rerender } = renderHook(() =>
                useStructureFormValidation<ILoginForm>(INITIAL_LOGIN, loginSchema)
            );

            act(() => {
                result.current.validate();
            });
            const before = { ...result.current.formErrors };

            locale = 'it';
            rerender();

            expect(locale).toBe('it');
            expect(result.current.formErrors).toEqual(before);
        });

        it('resolves a schema whose messages are thunks just as late as a factory', () => {
            let currentMessage = 'Invalid email address (en)';
            const { result } = renderHook(() =>
                useStructureFormValidation<ILoginForm>(
                    INITIAL_LOGIN,
                    // built ONCE — only the message is deferred
                    localizedSchema(() => currentMessage)
                )
            );

            act(() => {
                result.current.validate();
            });
            expect(result.current.formErrors.email).toContain('Invalid email address (en)');

            currentMessage = 'Indirizzo email non valido (it)';
            act(() => {
                result.current.validate();
            });
            expect(result.current.formErrors.email).toContain('Indirizzo email non valido (it)');
        });
    });

    describe('validate — multiple errors on one field', () => {
        interface IPasswordForm {
            password: string;
        }
        const strongSchema = z.object({
            password: z.string().min(8, 'at least 8 characters').regex(/\d/, 'at least one digit')
        });

        it('accumulates EVERY failing check for a field, not just the last one', () => {
            const { result } = renderHook(() =>
                useStructureFormValidation<IPasswordForm>({ password: '' }, strongSchema)
            );
            act(() => {
                result.current.setForm({ password: 'ab' }); // fails BOTH min(8) and regex(/\d/)
            });
            act(() => {
                result.current.validate();
            });

            // Both messages must survive: a per-issue reset would keep only one.
            expect(result.current.formErrors.password).toEqual([
                'at least 8 characters',
                'at least one digit'
            ]);
        });
    });
});
