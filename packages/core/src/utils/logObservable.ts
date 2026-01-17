import { type MonoTypeOperatorFunction, tap } from "rxjs";

type Opts = {
	printValue?: boolean;
	enabled?: boolean;
};

export const logObservable = <T>(
	label: string,
	opts?: Opts,
): MonoTypeOperatorFunction<T> =>
	tap((value) => {
		const { printValue = false, enabled = true } = opts || {};

		if (!label || !enabled) return;

		const text = `[kheopskit] observable ${label} emit`;

		if (printValue) console.debug(text, value);
		else console.debug(text);
	});
