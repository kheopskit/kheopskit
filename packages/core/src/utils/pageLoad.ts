import { Observable } from "rxjs";

export const pageLoaded$ = new Observable<boolean>((subscriber) => {
	if (typeof document === "undefined") {
		subscriber.next(false);
		return;
	}

	if (document.readyState === "complete") {
		subscriber.next(true);
		subscriber.complete();
		return;
	}

	subscriber.next(false);

	const onLoad = () => {
		subscriber.next(true);
		subscriber.complete();
	};
	window.addEventListener("load", onLoad, { once: true });

	return () => window.removeEventListener("load", onLoad);
});
