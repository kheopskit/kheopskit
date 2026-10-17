import { firstValueFrom } from "rxjs";
import { describe, expect, it } from "vitest";
import { createKheopskitStore } from "../api/store";
import type { KheopskitStoreData } from "../api/types";
import { createMemoryStorage } from "./memoryStorage";

describe("createMemoryStorage", () => {
	it("gets, sets and removes items", () => {
		const storage = createMemoryStorage();

		expect(storage.getItem("key")).toBeNull();
		storage.setItem("key", "value");
		expect(storage.getItem("key")).toBe("value");
		storage.removeItem("key");
		expect(storage.getItem("key")).toBeNull();
	});

	it("tells subscribers of a key about its writes until they unsubscribe", () => {
		const storage = createMemoryStorage();
		const heard: (string | null)[] = [];
		const unsubscribe = storage.subscribe("key", (value) => heard.push(value));

		storage.setItem("other", "ignored");
		storage.setItem("key", "a");
		storage.removeItem("key");
		unsubscribe();
		storage.setItem("key", "b");

		expect(heard).toEqual(["a", null]);
	});

	it("syncs another store on the same storage", () => {
		const storage = createMemoryStorage();
		const writer = createKheopskitStore({ storage });
		const reader = createKheopskitStore({ storage });
		const states: KheopskitStoreData[] = [];
		const subscription = reader.observable.subscribe((state) =>
			states.push(state),
		);

		writer.rememberWallet("polkadot:talisman");

		expect(states.at(-1)?.remembered).toEqual(["polkadot:talisman"]);
		subscription.unsubscribe();
		writer.destroy();
		reader.destroy();
	});

	it("keeps stores on different storages apart", async () => {
		const writer = createKheopskitStore({ storage: createMemoryStorage() });
		const reader = createKheopskitStore({ storage: createMemoryStorage() });

		writer.rememberWallet("polkadot:talisman");

		expect(await firstValueFrom(reader.observable)).toEqual({});
	});
});
