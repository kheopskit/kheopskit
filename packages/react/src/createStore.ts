import { BehaviorSubject, type Observable } from "rxjs";

export const createStore = <T>(observable$: Observable<T>, initialValue: T) => {
	const subject = new BehaviorSubject<T>(initialValue);

	const sub = observable$.subscribe((value) => {
		subject.next(value);
	});

	const getSnapshot = () => subject.getValue();

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
		subscribe,
		destroy,
	};
};
