import { BehaviorSubject, filter, fromEvent, map } from "rxjs";

export const createStore = <T>(key: string, defaultValue: T) => {
	// SSR guard - return a no-op store during server-side rendering
	if (typeof window === "undefined") {
		const subject = new BehaviorSubject<T>(defaultValue);
		return {
			observable: subject.asObservable(),
			mutate: (_transform: (prev: T) => T) => {},
			subscribe: (_callback: (val: T) => void) => () => {},
			getSnapshot: () => defaultValue,
			getServerSnapshot: () => defaultValue,
		};
	}

	const subject = new BehaviorSubject<T>(getStoredData(key, defaultValue));

	// Cross-tab sync via 'storage' event (won't fire if key is updated from same tab)
	fromEvent<StorageEvent>(window, "storage")
		.pipe(
			filter((event) => event.key === key),
			map((event) => parseData(event.newValue, defaultValue)),
		)
		.subscribe((newValue) => subject.next(newValue));

	const update = (val: T) => {
		setStoredData(key, val);
		subject.next(val);
	};

	const subscribe = (callback: (val: T) => void) => {
		const subscription = subject.subscribe(callback);
		return () => {
			subscription.unsubscribe();
		};
	};

	const getSnapshot = () => subject.getValue();

	return {
		observable: subject.asObservable(),
		mutate: (transform: (prev: T) => T) =>
			update(transform(subject.getValue())),

		// to use with useSyncExternalStore
		subscribe,
		getSnapshot,
		getServerSnapshot: () => defaultValue,
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

const getStoredData = <T>(key: string, defaultValue: T): T => {
	if (typeof window === "undefined") return defaultValue;
	const str = localStorage.getItem(key);
	return parseData(str, defaultValue);
};

const setStoredData = <T>(key: string, val: T) => {
	if (typeof window === "undefined") return;
	const str = JSON.stringify(val);
	localStorage.setItem(key, str);
};
