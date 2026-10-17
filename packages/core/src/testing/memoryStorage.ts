import type { SyncableStorage } from "../utils/storage";

type Listener = (value: string | null) => void;

/**
 * A `SyncableStorage` held in memory. `subscribe` listeners hear every write to
 * their key, their own store's included, so stores sharing one instance stay in
 * sync.
 */
export const createMemoryStorage = (): Required<SyncableStorage> => {
	const items = new Map<string, string>();
	const listeners = new Map<string, Set<Listener>>();

	const notify = (key: string, value: string | null) => {
		for (const listener of listeners.get(key) ?? []) listener(value);
	};

	return {
		getItem: (key) => items.get(key) ?? null,
		setItem: (key, value) => {
			items.set(key, value);
			notify(key, value);
		},
		removeItem: (key) => {
			items.delete(key);
			notify(key, null);
		},
		subscribe: (key, listener) => {
			const keyListeners = listeners.get(key) ?? new Set<Listener>();
			listeners.set(key, keyListeners);
			keyListeners.add(listener);
			return () => {
				keyListeners.delete(listener);
			};
		},
	};
};
