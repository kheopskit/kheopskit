import type { KheopskitState } from "@kheopskit/core";
import { useMemo, useSyncExternalStore } from "react";
import { useKheopskitExternalStore } from "./context";

// Core recreates an item's connect, disconnect and sign closures on each
// emission; within one pipeline they all call the same per-item logic.
const isSameItem = (a: object, b: object) => {
	const previous = a as Record<string, unknown>;
	const next = b as Record<string, unknown>;
	const keys = Object.keys(previous);
	return (
		keys.length === Object.keys(next).length &&
		keys.every(
			(key) =>
				Object.hasOwn(next, key) &&
				(Object.is(previous[key], next[key]) ||
					(typeof previous[key] === "function" &&
						typeof next[key] === "function")),
		)
	);
};

export const useStateItem = <K, T extends object>(
	hookName: string,
	key: K,
	select: (state: KheopskitState, key: K) => T | undefined,
): T | undefined => {
	const store = useKheopskitExternalStore(hookName);
	const snapshots = useMemo(() => {
		let last: T | undefined;
		return {
			getSnapshot: () => {
				const next = select(store.getSnapshot(), key);
				if (!last || !next || !isSameItem(last, next)) last = next;
				return last;
			},
			getServerSnapshot: () => select(store.getServerSnapshot(), key),
		};
	}, [store, key, select]);
	return useSyncExternalStore(
		store.subscribe,
		snapshots.getSnapshot,
		snapshots.getServerSnapshot,
	);
};
