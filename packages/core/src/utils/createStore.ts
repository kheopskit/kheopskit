import { BehaviorSubject } from "rxjs";
import { type SyncableStorage, safeLocalStorage } from "./storage";

export const createStore = <T>(
	key: string,
	defaultValue: T,
	storage: SyncableStorage = safeLocalStorage,
) => {
	const subject = new BehaviorSubject<T>(
		getStoredData(key, defaultValue, storage),
	);

	// Cross-tab sync via storage.subscribe (uses storage event for localStorage, BroadcastChannel for cookies)
	// Only subscribe if window is available (client-side) and storage supports it
	let unsubscribeStorage: (() => void) | undefined;
	if (typeof window !== "undefined" && storage.subscribe) {
		unsubscribeStorage = storage.subscribe(key, (newValue) => {
			subject.next(parseData(newValue, defaultValue));
		});
	}

	const update = (val: T) => {
		setStoredData(key, val, storage);
		subject.next(val);
	};

	return {
		observable: subject.asObservable(),
		set: (val: T) => update(val),
		mutate: (transform: (prev: T) => T) =>
			update(transform(subject.getValue())),
		get: () => structuredClone(subject.getValue()),
		/**
		 * Cleanup subscriptions. Call this when the store is no longer needed.
		 */
		destroy: () => {
			unsubscribeStorage?.();
			subject.complete();
		},
	};
};

const parseData = <T>(str: string | null, defaultValue: T): T => {
	try {
		if (str) return JSON.parse(str);
	} catch {
		// invalid data
	}
	return defaultValue;
};

const getStoredData = <T>(
	key: string,
	defaultValue: T,
	storage: SyncableStorage,
): T => {
	const str = storage.getItem(key);
	return parseData(str, defaultValue);
};

const setStoredData = <T>(key: string, val: T, storage: SyncableStorage) => {
	const str = JSON.stringify(val);
	storage.setItem(key, str);
};
