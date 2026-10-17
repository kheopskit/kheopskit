import type { KheopskitState } from "@kheopskit/core";
import { useMemo, useSyncExternalStore } from "react";
import { useKheopskitExternalStore } from "./context";

const isSameItemIgnoringClosures = (a: object, b: object) => {
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
		let cached: { generation: number; item: T } | undefined;
		return {
			getSnapshot: () => {
				const item = select(store.getSnapshot(), key);
				const generation = store.getSnapshotGeneration();
				const reusable =
					cached !== undefined &&
					item !== undefined &&
					cached.generation === generation &&
					isSameItemIgnoringClosures(cached.item, item);
				if (!reusable) cached = item && { generation, item };
				return cached?.item;
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
