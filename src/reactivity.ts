export interface Ref<T> {
    value: T;
}

export const ref = <T = undefined>(value?: T): Ref<T> => ({ value: value as T });

export const computed = <T>(getter: () => T): Readonly<Ref<T>> =>
    Object.defineProperty({}, 'value', {
        get: getter,
        enumerable: true
    }) as Readonly<Ref<T>>;
