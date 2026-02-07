import { BehaviorSubject, type Observable } from "rxjs";

export const createStore = <T>(
	observable$: Observable<T>,
	initialValue: T,
	serverValue?: T,
) => {
	const subject = new BehaviorSubject<T>(initialValue);

	const sub = observable$.subscribe((value) => {
		subject.next(value);
	});

	const getSnapshot = () => subject.getValue();

	/**
	 * Returns the server-side snapshot for SSR hydration.
	 * This prevents hydration mismatches by providing a consistent
	 * value during server rendering.
	 */
	const getServerSnapshot = () => serverValue ?? initialValue;

	const subscribe = (callback: (value: T) => void) => {
		const sub = subject.subscribe(callback);

		return () => {
			sub.unsubscribe();
		};
	};

	const destroy = () => {
		sub.unsubscribe();
	};

	return {
		getSnapshot,
		getServerSnapshot,
		subscribe,
		destroy,
	};
};
