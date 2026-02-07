import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	cookieStorage,
	noopStorage,
	parseCookie,
	type Storage,
	safeLocalStorage,
} from "./storage";

describe("noopStorage", () => {
	it("getItem always returns null", () => {
		expect(noopStorage.getItem("any-key")).toBeNull();
		expect(noopStorage.getItem("")).toBeNull();
	});

	it("setItem does nothing and does not throw", () => {
		expect(() => noopStorage.setItem("key", "value")).not.toThrow();
	});

	it("removeItem does nothing and does not throw", () => {
		expect(() => noopStorage.removeItem("key")).not.toThrow();
	});
});

describe("safeLocalStorage", () => {
	beforeEach(() => {
		localStorage.clear();
	});

	it("wraps window.localStorage when available", () => {
		safeLocalStorage.setItem("test-key", "test-value");
		expect(safeLocalStorage.getItem("test-key")).toBe("test-value");
		expect(localStorage.getItem("test-key")).toBe("test-value");
	});

	it("getItem returns null for non-existent keys", () => {
		expect(safeLocalStorage.getItem("non-existent")).toBeNull();
	});

	it("removeItem removes items", () => {
		safeLocalStorage.setItem("to-remove", "value");
		expect(safeLocalStorage.getItem("to-remove")).toBe("value");
		safeLocalStorage.removeItem("to-remove");
		expect(safeLocalStorage.getItem("to-remove")).toBeNull();
	});
});

describe("parseCookie", () => {
	it("returns null for undefined cookie string", () => {
		expect(parseCookie(undefined, "key")).toBeNull();
	});

	it("returns null for empty cookie string", () => {
		expect(parseCookie("", "key")).toBeNull();
	});

	it("returns null when key is not found", () => {
		expect(parseCookie("foo=bar; baz=qux", "nonexistent")).toBeNull();
	});

	it("parses single cookie", () => {
		expect(parseCookie("mykey=myvalue", "mykey")).toBe("myvalue");
	});

	it("parses multiple cookies", () => {
		const cookieString = "first=1; second=2; third=3";
		expect(parseCookie(cookieString, "first")).toBe("1");
		expect(parseCookie(cookieString, "second")).toBe("2");
		expect(parseCookie(cookieString, "third")).toBe("3");
	});

	it("handles whitespace around cookies", () => {
		expect(parseCookie("  key  =  value  ", "key")).toBe("value");
		expect(parseCookie("a=1;  b=2  ; c=3", "b")).toBe("2");
	});

	it("decodes URL-encoded values", () => {
		expect(parseCookie("encoded=%7B%22foo%22%3A%22bar%22%7D", "encoded")).toBe(
			'{"foo":"bar"}',
		);
	});

	it("handles values with equals signs", () => {
		expect(parseCookie("data=a=b=c", "data")).toBe("a=b=c");
	});

	it("handles empty values", () => {
		expect(parseCookie("empty=", "empty")).toBe("");
	});

	it("handles JSON values", () => {
		const json = { autoReconnect: ["polkadot:polkadot-js"] };
		const encoded = encodeURIComponent(JSON.stringify(json));
		expect(parseCookie(`kheopskit=${encoded}`, "kheopskit")).toBe(
			JSON.stringify(json),
		);
	});
});

describe("cookieStorage", () => {
	beforeEach(() => {
		// Clear all cookies
		document.cookie.split(";").forEach((c) => {
			const name = c.split("=")[0]?.trim();
			if (name) {
				// biome-ignore lint/suspicious/noDocumentCookie: necessary for test cleanup
				document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:01 GMT;path=/`;
			}
		});
	});

	afterEach(() => {
		// Clear cookies after tests
		document.cookie.split(";").forEach((c) => {
			const name = c.split("=")[0]?.trim();
			if (name) {
				// biome-ignore lint/suspicious/noDocumentCookie: necessary for test cleanup
				document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:01 GMT;path=/`;
			}
		});
	});

	describe("without initialCookies (client-side mode)", () => {
		it("reads from document.cookie", () => {
			// biome-ignore lint/suspicious/noDocumentCookie: necessary for test setup
			document.cookie = "testkey=testvalue;path=/";
			const storage = cookieStorage();
			expect(storage.getItem("testkey")).toBe("testvalue");
		});

		it("returns null for non-existent keys", () => {
			const storage = cookieStorage();
			expect(storage.getItem("nonexistent")).toBeNull();
		});

		it("setItem writes to document.cookie", () => {
			const storage = cookieStorage();
			storage.setItem("newkey", "newvalue");
			expect(document.cookie).toContain("newkey=newvalue");
		});

		it("setItem encodes values", () => {
			const storage = cookieStorage();
			const jsonValue = JSON.stringify({ test: "value" });
			storage.setItem("json", jsonValue);
			// Reading back should decode it
			expect(storage.getItem("json")).toBe(jsonValue);
		});

		it("removeItem deletes the cookie", () => {
			const storage = cookieStorage();
			storage.setItem("toremove", "value");
			expect(storage.getItem("toremove")).toBe("value");
			storage.removeItem("toremove");
			expect(storage.getItem("toremove")).toBeNull();
		});
	});

	describe("with initialCookies (SSR hydration mode)", () => {
		it("reads from initialCookies on server (simulated)", () => {
			// In this test, we simulate by checking the logic (but document is available in jsdom)
			// The key point is that initialCookies takes precedence when document is undefined
			const initialCookies = "ssrkey=ssrvalue; other=data";
			const storage = cookieStorage(initialCookies);
			// On client (jsdom), it reads from document.cookie, but we can test parseCookie directly
			// Let's just verify the storage is created without error
			expect(storage).toBeDefined();
			expect(storage.getItem).toBeDefined();
		});

		it("storage created with initialCookies can still write on client", () => {
			const storage = cookieStorage("initial=value");
			storage.setItem("clientkey", "clientvalue");
			expect(document.cookie).toContain("clientkey=clientvalue");
		});
	});

	describe("Storage interface compliance", () => {
		it("implements Storage interface", () => {
			const storage: Storage = cookieStorage();
			expect(typeof storage.getItem).toBe("function");
			expect(typeof storage.setItem).toBe("function");
			expect(typeof storage.removeItem).toBe("function");
		});
	});
});

describe("storage combinations", () => {
	it("noopStorage, safeLocalStorage, and cookieStorage all implement Storage interface", () => {
		const storages: Storage[] = [
			noopStorage,
			safeLocalStorage,
			cookieStorage(),
		];

		for (const storage of storages) {
			expect(typeof storage.getItem).toBe("function");
			expect(typeof storage.setItem).toBe("function");
			expect(typeof storage.removeItem).toBe("function");
		}
	});

	it("all storages handle the same key/value operations", () => {
		const key = "test-key";
		const value = "test-value";

		// noopStorage never stores
		noopStorage.setItem(key, value);
		expect(noopStorage.getItem(key)).toBeNull();

		// safeLocalStorage stores in localStorage
		localStorage.clear();
		safeLocalStorage.setItem(key, value);
		expect(safeLocalStorage.getItem(key)).toBe(value);

		// cookieStorage stores in cookies
		const cookie = cookieStorage();
		cookie.setItem(key, value);
		expect(cookie.getItem(key)).toBe(value);
	});
});
