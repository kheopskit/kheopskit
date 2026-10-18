import {
	concat,
	map,
	merge,
	NEVER,
	type Observable,
	of,
	switchMap,
	timer,
} from "rxjs";
import { pageLoaded$ } from "./pageLoad";

const READ_TAIL_MS = [100, 300, 600, 1100];

const tail$: Observable<void> = merge(
	of(undefined),
	...READ_TAIL_MS.map((ms) => timer(ms)),
).pipe(map(() => undefined));

export const createRegistryReads$ = (): Observable<void> =>
	typeof window === "undefined"
		? concat(of(undefined), NEVER)
		: pageLoaded$.pipe(switchMap(() => tail$));
