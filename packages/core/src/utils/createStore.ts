import { BehaviorSubject, Observable } from "rxjs";
import { type SyncableStorage, safeLocalStorage } from "./storage";

export const createStore = <T>(
	key: string,
	defaultValue: T,
	storage: SyncableStorage = safeLocalStorage,
	normalize: (value: T) => T = (value) => value,
) => {
	const read = (str: string | null) => normalize(parseData(str, defaultValue));
	const syncsAcrossTabs =
		typeof window !== "undefined" && storage.subscribe !== undefined;
	const subject = new BehaviorSubject<T>(read(storage.getItem(key)));
	let observers = 0;
	let stopSync: (() => void) | undefined;

	const latestValue = () => {
		if (syncsAcrossTabs && observers === 0)
			subject.next(read(storage.getItem(key)));
		return subject.getValue();
	};

	const observable = new Observable<T>((subscriber) => {
		if (observers === 0 && syncsAcrossTabs) {
			latestValue();
			stopSync = storage.subscribe?.(key, (newValue) => {
				subject.next(read(newValue));
			});
		}
		observers++;
		const subscription = subject.subscribe(subscriber);
		return () => {
			subscription.unsubscribe();
			observers--;
			if (observers === 0) stopSync?.();
		};
	});

	const update = (val: T) => {
		setStoredData(key, val, storage);
		subject.next(val);
	};

	return {
		observable,
		set: (val: T) => update(val),
		mutate: (transform: (prev: T) => T) => update(transform(latestValue())),
		get: () => structuredClone(latestValue()),
		destroy: () => subject.complete(),
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

const setStoredData = <T>(key: string, val: T, storage: SyncableStorage) => {
	const str = JSON.stringify(val);
	storage.setItem(key, str);
};
