/**
 * Shared fixtures & entity factories for the structureRestApi test suite.
 * Plain module (not a *.spec.ts) so Jest's testMatch ignores it.
 */

export interface IUser {
    id: number;
    name: string;
    email: string;
    role?: string;
    bio?: string;
}

export interface IProduct {
    id: number;
    title: string;
    price?: number;
}

export interface IArticle {
    id: number;
    title: string;
    category: string;
    tag?: string;
}

/** N users starting at startId (User 1, User 2, ...). */
export const buildUsers = (count: number, startId = 1): IUser[] =>
    Array.from({ length: count }, (_, i) => ({
        id: startId + i,
        name: `User ${startId + i}`,
        email: `user${startId + i}@example.com`
    }));

/** N products starting at startId. */
export const buildProducts = (count: number, startId = 1): IProduct[] =>
    Array.from({ length: count }, (_, i) => ({
        id: startId + i,
        title: `Product ${startId + i}`,
        price: (startId + i) * 10
    }));

/** N articles of a category starting at startId. */
export const buildArticles = (count: number, category = 'tech', startId = 1): IArticle[] =>
    Array.from({ length: count }, (_, i) => ({
        id: startId + i,
        title: `Article ${startId + i}`,
        category
    }));

/** A small, named, stable set of users used across many specs. */
export const USERS: IUser[] = [
    { id: 1, name: 'Alice', email: 'alice@example.com' },
    { id: 2, name: 'Bob', email: 'bob@example.com' },
    { id: 3, name: 'Carol', email: 'carol@example.com' }
];

/** A user with every optional field populated (for merge/replace tests). */
export const FULL_USER: IUser = {
    id: 1,
    name: 'Alice',
    email: 'alice@example.com',
    role: 'admin',
    bio: 'hello'
};
