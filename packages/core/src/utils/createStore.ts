import { BehaviorSubject, filter, fromEvent, map } from "rxjs";
import { type Storage, safeLocalStorage } from "./storage";

export const createStore = <T>(
	key: string,
	defaultValue: T,
	storage: Storage = safeLocalStorage,
) => {
	const subject = new BehaviorSubject<T>(
		getStoredData(key, defaultValue, storage),
	);

	// Cross-tab sync via 'storage' event (won't fire if key is updated from same tab)
	// Only subscribe to storage events if window is available (client-side)
	if (typeof window !== "undefined") {
		fromEvent<StorageEvent>(window, "storage")
			.pipe(
				filter((event) => event.key === key),
				map((event) => parseData(event.newValue, defaultValue)),
			)
			.subscribe((newValue) => subject.next(newValue));
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
	storage: Storage,
): T => {
	const str = storage.getItem(key);
	return parseData(str, defaultValue);
};

const setStoredData = <T>(key: string, val: T, storage: Storage) => {
	const str = JSON.stringify(val);
	storage.setItem(key, str);
};
