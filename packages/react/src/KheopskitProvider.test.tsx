/// <reference types="@testing-library/jest-dom" />
import type { KheopskitConfig } from "@kheopskit/core";
import { render, screen } from "@testing-library/react";
import { useContext } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KheopskitContext } from "./context";
import {
	KheopskitProvider,
	type KheopskitProviderProps,
} from "./KheopskitProvider";
import { useWallets } from "./useWallets";

// Helper component to access context
const ContextConsumer = () => {
	const ctx = useContext(KheopskitContext);
	return (
		<div>
			<span data-testid="wallets-count">{ctx?.state.wallets.length ?? -1}</span>
			<span data-testid="accounts-count">
				{ctx?.state.accounts.length ?? -1}
			</span>
			<span data-testid="has-context">{ctx ? "yes" : "no"}</span>
		</div>
	);
};

// Helper component using useWallets hook
const WalletsConsumer = () => {
	const state = useWallets();
	return (
		<div>
			<span data-testid="hook-wallets">{state.wallets.length}</span>
			<span data-testid="hook-accounts">{state.accounts.length}</span>
			<span data-testid="hook-platforms">
				{state.config.platforms.join(",")}
			</span>
		</div>
	);
};

describe("KheopskitProvider", () => {
	beforeEach(() => {
		localStorage.clear();
		// Clear cookies
		document.cookie.split(";").forEach((c) => {
			const name = c.split("=")[0]?.trim();
			if (name) {
				// biome-ignore lint/suspicious/noDocumentCookie: necessary for test cleanup
				document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:01 GMT;path=/`;
			}
		});
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe("basic rendering", () => {
		it("renders children", () => {
			render(
				<KheopskitProvider>
					<div data-testid="child">Hello</div>
				</KheopskitProvider>,
			);

			expect(screen.getByTestId("child")).toHaveTextContent("Hello");
		});

		it("provides context to children", () => {
			render(
				<KheopskitProvider>
					<ContextConsumer />
				</KheopskitProvider>,
			);

			expect(screen.getByTestId("has-context")).toHaveTextContent("yes");
		});

		it("initializes with empty wallets and accounts", () => {
			render(
				<KheopskitProvider>
					<ContextConsumer />
				</KheopskitProvider>,
			);

			expect(screen.getByTestId("wallets-count")).toHaveTextContent("0");
			expect(screen.getByTestId("accounts-count")).toHaveTextContent("0");
		});
	});

	describe("config prop combinations", () => {
		it("uses default config when no config provided", () => {
			render(
				<KheopskitProvider>
					<WalletsConsumer />
				</KheopskitProvider>,
			);

			// Default platforms is ["polkadot"]
			expect(screen.getByTestId("hook-platforms")).toHaveTextContent(
				"polkadot",
			);
		});

		it("accepts custom config with polkadot platform", () => {
			const config: Partial<KheopskitConfig> = {
				platforms: ["polkadot"],
				autoReconnect: false,
			};

			render(
				<KheopskitProvider config={config}>
					<WalletsConsumer />
				</KheopskitProvider>,
			);

			expect(screen.getByTestId("hook-platforms")).toHaveTextContent(
				"polkadot",
			);
		});

		it("accepts custom config with ethereum platform", () => {
			const config: Partial<KheopskitConfig> = {
				platforms: ["ethereum"],
			};

			render(
				<KheopskitProvider config={config}>
					<WalletsConsumer />
				</KheopskitProvider>,
			);

			expect(screen.getByTestId("hook-platforms")).toHaveTextContent(
				"ethereum",
			);
		});

		it("accepts custom config with both platforms", () => {
			const config: Partial<KheopskitConfig> = {
				platforms: ["polkadot", "ethereum"],
			};

			render(
				<KheopskitProvider config={config}>
					<WalletsConsumer />
				</KheopskitProvider>,
			);

			expect(screen.getByTestId("hook-platforms")).toHaveTextContent(
				"polkadot,ethereum",
			);
		});

		it("accepts config with autoReconnect true", () => {
			const config: Partial<KheopskitConfig> = {
				autoReconnect: true,
			};

			render(
				<KheopskitProvider config={config}>
					<WalletsConsumer />
				</KheopskitProvider>,
			);

			// Should render without error
			expect(screen.getByTestId("hook-wallets")).toBeInTheDocument();
		});

		it("accepts config with autoReconnect false", () => {
			const config: Partial<KheopskitConfig> = {
				autoReconnect: false,
			};

			render(
				<KheopskitProvider config={config}>
					<WalletsConsumer />
				</KheopskitProvider>,
			);

			expect(screen.getByTestId("hook-wallets")).toBeInTheDocument();
		});

		it("accepts config with debug true", () => {
			const consoleSpy = vi
				.spyOn(console, "debug")
				.mockImplementation(() => {});
			const config: Partial<KheopskitConfig> = {
				debug: true,
			};

			render(
				<KheopskitProvider config={config}>
					<WalletsConsumer />
				</KheopskitProvider>,
			);

			// Debug mode may log, but should render
			expect(screen.getByTestId("hook-wallets")).toBeInTheDocument();
			consoleSpy.mockRestore();
		});
	});

	describe("ssrCookies prop combinations", () => {
		it("works without ssrCookies (uses localStorage)", () => {
			render(
				<KheopskitProvider>
					<WalletsConsumer />
				</KheopskitProvider>,
			);

			expect(screen.getByTestId("hook-wallets")).toBeInTheDocument();
		});

		it("works with empty ssrCookies", () => {
			render(
				<KheopskitProvider ssrCookies="">
					<WalletsConsumer />
				</KheopskitProvider>,
			);

			expect(screen.getByTestId("hook-wallets")).toBeInTheDocument();
		});

		it("works with ssrCookies containing kheopskit data", () => {
			const cookieData = { autoReconnect: ["polkadot:polkadot-js"] };
			const ssrCookies = `kheopskit=${encodeURIComponent(JSON.stringify(cookieData))}`;

			render(
				<KheopskitProvider ssrCookies={ssrCookies}>
					<WalletsConsumer />
				</KheopskitProvider>,
			);

			expect(screen.getByTestId("hook-wallets")).toBeInTheDocument();
		});

		it("works with ssrCookies containing other cookies", () => {
			const ssrCookies = "session=abc123; theme=dark; kheopskit={}";

			render(
				<KheopskitProvider ssrCookies={ssrCookies}>
					<WalletsConsumer />
				</KheopskitProvider>,
			);

			expect(screen.getByTestId("hook-wallets")).toBeInTheDocument();
		});

		it("filters cached polkadot accounts by polkadotAccountTypes during SSR hydration", () => {
			// Compact cookie with wallet + ecdsa account (type index 2)
			const compactCookie = {
				v: 1,
				w: [["polkadot:talisman", "Talisman", 1, 0]],
				a: [
					[
						"polkadot:talisman",
						"5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY",
						null,
						null,
						2,
					],
				],
			};
			const cookieValue = encodeURIComponent(JSON.stringify(compactCookie));
			// biome-ignore lint/suspicious/noDocumentCookie: necessary for test setup
			document.cookie = `kheopskit=${cookieValue};path=/`;
			const ssrCookies = document.cookie;

			render(
				<KheopskitProvider
					config={{ polkadotAccountTypes: ["sr25519"] }}
					ssrCookies={ssrCookies}
				>
					<ContextConsumer />
				</KheopskitProvider>,
			);

			// ecdsa account should be filtered out since only sr25519 is allowed
			expect(screen.getByTestId("accounts-count")).toHaveTextContent("0");
			// wallet should still appear
			expect(screen.getByTestId("wallets-count")).toHaveTextContent("1");
		});
	});

	describe("config + ssrCookies combinations", () => {
		it("works with config and ssrCookies together", () => {
			const config: Partial<KheopskitConfig> = {
				platforms: ["polkadot", "ethereum"],
				autoReconnect: true,
			};
			const cookieData = { autoReconnect: ["polkadot:talisman"] };
			const ssrCookies = `kheopskit=${encodeURIComponent(JSON.stringify(cookieData))}`;

			render(
				<KheopskitProvider config={config} ssrCookies={ssrCookies}>
					<WalletsConsumer />
				</KheopskitProvider>,
			);

			expect(screen.getByTestId("hook-platforms")).toHaveTextContent(
				"polkadot,ethereum",
			);
		});

		it("handles all config options with ssrCookies", () => {
			const config: Partial<KheopskitConfig> = {
				platforms: ["ethereum"],
				autoReconnect: false,
				debug: false,
			};
			const ssrCookies = "kheopskit={}";

			render(
				<KheopskitProvider config={config} ssrCookies={ssrCookies}>
					<WalletsConsumer />
				</KheopskitProvider>,
			);

			expect(screen.getByTestId("hook-platforms")).toHaveTextContent(
				"ethereum",
			);
		});
	});

	describe("useWallets hook", () => {
		it("throws error when used outside provider", () => {
			const consoleError = vi
				.spyOn(console, "error")
				.mockImplementation(() => {});

			expect(() => {
				render(<WalletsConsumer />);
			}).toThrow("useWallets can't be used without a KheopskitProvider");

			consoleError.mockRestore();
		});

		it("returns state with wallets array", () => {
			render(
				<KheopskitProvider>
					<WalletsConsumer />
				</KheopskitProvider>,
			);

			expect(screen.getByTestId("hook-wallets")).toHaveTextContent("0");
		});

		it("returns state with accounts array", () => {
			render(
				<KheopskitProvider>
					<WalletsConsumer />
				</KheopskitProvider>,
			);

			expect(screen.getByTestId("hook-accounts")).toHaveTextContent("0");
		});

		it("returns state with config", () => {
			render(
				<KheopskitProvider config={{ platforms: ["polkadot"] }}>
					<WalletsConsumer />
				</KheopskitProvider>,
			);

			expect(screen.getByTestId("hook-platforms")).toHaveTextContent(
				"polkadot",
			);
		});
	});

	describe("re-render behavior", () => {
		it("does not recreate store on re-render with same props", () => {
			const { rerender } = render(
				<KheopskitProvider>
					<WalletsConsumer />
				</KheopskitProvider>,
			);

			const initialContent = screen.getByTestId("hook-wallets").textContent;

			rerender(
				<KheopskitProvider>
					<WalletsConsumer />
				</KheopskitProvider>,
			);

			expect(screen.getByTestId("hook-wallets").textContent).toBe(
				initialContent,
			);
		});
	});
});

describe("KheopskitProvider type safety", () => {
	it("KheopskitProviderProps accepts all valid prop combinations", () => {
		// This is a compile-time check - if this compiles, the types are correct
		const validProps: KheopskitProviderProps[] = [
			{ children: <div /> },
			{ children: <div />, config: {} },
			{ children: <div />, ssrCookies: "" },
			{ children: <div />, config: {}, ssrCookies: "" },
			{ children: <div />, config: { platforms: ["polkadot"] } },
			{ children: <div />, config: { platforms: ["ethereum"] } },
			{ children: <div />, config: { platforms: ["polkadot", "ethereum"] } },
			{ children: <div />, config: { autoReconnect: true } },
			{ children: <div />, config: { autoReconnect: false } },
			{ children: <div />, config: { debug: true } },
			{ children: <div />, config: { debug: false } },
			{
				children: <div />,
				config: { platforms: ["polkadot"], autoReconnect: true, debug: false },
				ssrCookies: "cookie=value",
			},
		];

		// All props should be valid
		expect(validProps.length).toBeGreaterThan(0);
	});
});
