import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryStorage } from "../../testing";
import type { SyncableStorage } from "../../utils/storage";
import { ethereum } from "../ethereum/plugin";
import { polkadot } from "../polkadot/plugin";
import { solana } from "../solana/plugin";
import type { KheopskitConfig } from "../types";
import {
	type Delivery,
	ETHEREUM_BASELINE,
	type EthereumBehavior,
	type FakeEthereumWallet,
	type FakeWallet,
	installEthereumWallet,
	installPolkadotWallet,
	installSolanaWallet,
	POLKADOT_BASELINE,
	type PolkadotBehavior,
	SOLANA_BASELINE,
	type SolanaBehavior,
	uninstallAll,
} from "./fakeWallets";
import { closeAllPages, type Frame, openPage, settle, shownOf } from "./page";

let storage: SyncableStorage;

beforeEach(() => {
	vi.useFakeTimers();
	storage = createMemoryStorage();
});

afterEach(() => {
	closeAllPages();
	uninstallAll();
	vi.useRealTimers();
});

type Variant<B> = { variant: string; behavior: B };

/** The baseline, then the baseline with one axis changed to each listed value. */
const variantsOf = <B extends object>(
	baseline: B,
	axes: { [K in keyof B]?: B[K][] },
): Variant<B>[] => [
	{ variant: "baseline", behavior: baseline },
	...Object.entries(axes).flatMap(([axis, values]) =>
		(values as unknown[]).map((value) => ({
			variant: `${axis}: ${JSON.stringify(value)}`,
			behavior: { ...baseline, [axis]: value },
		})),
	),
];

const DELIVERIES: Delivery[] = ["sync", "microtask", { latencyMs: 200 }];

const expectSteadyFrames = (frames: Frame[]) => {
	const repeats = frames.filter(
		(frame, i) =>
			i > 0 && JSON.stringify(frame) === JSON.stringify(frames[i - 1]),
	);
	expect(repeats, "frames that repeat the previous one").toEqual([]);
	for (const flag of ["isDiscovering", "isHydrating"] as const) {
		const comebacks = frames.filter(
			(frame, i) => i > 0 && frame[flag] && !frames[i - 1]?.[flag],
		);
		expect(comebacks, `frames where ${flag} comes back`).toEqual([]);
	}
};

type Page = ReturnType<typeof openPage>;

type Scenario = { run: () => Promise<string[]>; shows: string[] };

const scenarios = <W extends FakeWallet>({
	install,
	platforms,
	alice,
	bob,
}: {
	install: () => W;
	platforms: KheopskitConfig["platforms"];
	alice: string;
	bob: string;
}) => {
	const loadPage = () => openPage(storage, { platforms });
	const shownDuring = async (
		wallet: W,
		page: Page,
		...acts: (() => unknown)[]
	) => {
		const frames: Frame[] = [];
		for (const act of acts) frames.push(...(await page.framesDuring(act)));
		expectSteadyFrames(page.frames);
		return shownOf(wallet.label, frames);
	};
	const connectedPage = async (wallet: W) => {
		const page = loadPage();
		await page.framesDuring(() => page.wallet(wallet.label).connect());
		return page;
	};
	const reload = async (wallet: W, beforeReload: () => void = () => {}) => {
		(await connectedPage(wallet)).close();
		beforeReload();
		const promptsBefore = wallet.promptsShown();
		const page = loadPage();
		await settle();
		expectSteadyFrames(page.frames);
		expect(wallet.promptsShown(), "prompts opened by the page load").toBe(
			promptsBefore,
		);
		return shownOf(wallet.label, page.frames);
	};
	return {
		withWallet: (run: (wallet: W) => Promise<string[]>) => () => run(install()),
		loadPage,
		connectedPage,
		shownDuring,
		scenarios: {
			"a connect the user approves": {
				run: async () => {
					const wallet = install();
					const page = loadPage();
					return shownDuring(wallet, page, () =>
						page.wallet(wallet.label).connect(),
					);
				},
				shows: ["connecting", `connected: ${alice}`],
			},
			"a connect the user refuses": {
				run: async () => {
					const wallet = install();
					wallet.answerPrompts("refuse");
					const page = loadPage();
					return shownDuring(wallet, page, () =>
						page
							.wallet(wallet.label)
							.connect()
							.catch(() => {}),
					);
				},
				shows: ["connecting", "disconnected"],
			},
			"an account switch in the wallet": {
				run: async () => {
					const wallet = install();
					return shownDuring(wallet, await connectedPage(wallet), () =>
						wallet.setAccounts(["Bob"]),
					);
				},
				shows: [`connected: ${bob}`],
			},
			"a disconnect from the app": {
				run: async () => {
					const wallet = install();
					const page = await connectedPage(wallet);
					return shownDuring(wallet, page, () =>
						page.wallet(wallet.label).disconnect(),
					);
				},
				shows: ["disconnected"],
			},
			"a Disconnect All in the wallet": {
				run: async () => {
					const wallet = install();
					return shownDuring(
						wallet,
						await connectedPage(wallet),
						wallet.disconnectAll,
					);
				},
				shows: ["connected"],
			},
			"a Disconnect All, then a Connect All in the wallet": {
				run: async () => {
					const wallet = install();
					return shownDuring(
						wallet,
						await connectedPage(wallet),
						wallet.disconnectAll,
						wallet.connectAll,
					);
				},
				shows: ["connected", `connected: ${alice}`],
			},
			"a reload": {
				run: () => reload(install()),
				shows: [`connecting: ${alice} (cached)`, `connected: ${alice}`],
			},
			"a reload after a Disconnect All in the wallet": {
				run: () => {
					const wallet = install();
					return reload(wallet, wallet.disconnectAll);
				},
				shows: [`connecting: ${alice} (cached)`, "disconnected"],
			},
		} satisfies Record<string, Scenario>,
	};
};

type ScenarioName = keyof ReturnType<typeof scenarios>["scenarios"];

/** What kheopskit gets wrong today, for the listed variants, or every variant but the `except` ones. */
type KnownGap = { issue: number } & (
	| { variants: string[] }
	| { except?: string[] }
);

const covers = (gap: KnownGap | undefined, variant: string) =>
	!!gap &&
	("variants" in gap
		? gap.variants.includes(variant)
		: !gap.except?.includes(variant));

const describeVariants = <B extends object>(
	platform: string,
	variants: Variant<B>[],
	scenariosOf: (behavior: B) => Record<string, Scenario>,
	knownGaps: Partial<Record<ScenarioName, KnownGap>> = {},
) =>
	describe(`kheopskit$ shows ${platform} wallet the same, whatever the wallet does`, () => {
		const [baseline] = variants;
		if (!baseline) return;
		for (const [scenario, { shows }] of Object.entries(
			scenariosOf(baseline.behavior),
		)) {
			describe(`${scenario} shows ${shows.join(" → ")}`, () => {
				const gap = knownGaps[scenario as ScenarioName];
				for (const { variant, behavior } of variants) {
					const known = covers(gap, variant);
					const test = known ? it.fails : it;
					test(known ? `${variant} (#${gap?.issue})` : variant, async () => {
						const shown = await scenariosOf(behavior)[scenario]?.run();
						expect(shown).toEqual(shows);
					});
				}
			});
		}
	});

const REVOKED_RELOAD: KnownGap = { issue: 200 };

describeVariants(
	"a Polkadot",
	variantsOf<PolkadotBehavior>(POLKADOT_BASELINE, {
		delivery: DELIVERIES,
		refusal: [
			{ accountsGetRejects: "Site has not been authorised yet" },
			{ enableRejects: "Cancelled by user" },
		],
		revoked: [
			"grants no account",
			{ enableRejects: "No accounts are authorised to connect" },
		],
		firstListCallback: ["before subscribe returns"],
	}),
	(behavior) =>
		scenarios({
			install: () => installPolkadotWallet({ name: "Wallet" }, behavior),
			platforms: [polkadot()],
			alice: "Alice",
			bob: "Bob",
		}).scenarios,
	{ "a reload after a Disconnect All in the wallet": REVOKED_RELOAD },
);

const ethereumScenarios = (behavior: EthereumBehavior) => {
	const {
		scenarios: shared,
		withWallet,
		connectedPage,
		shownDuring,
	} = scenarios<FakeEthereumWallet>({
		install: () => installEthereumWallet({ name: "Wallet" }, behavior),
		platforms: [ethereum()],
		alice: "Alice @1",
		bob: "Bob @1",
	});
	return {
		...shared,
		"a chain switch in the wallet": {
			run: withWallet(async (wallet) =>
				shownDuring(wallet, await connectedPage(wallet), () =>
					wallet.switchChain("0x89"),
				),
			),
			shows: ["connected: Alice @137"],
		},
	};
};

const DISCONNECT_EVENT_FIRST = [
	'disconnectAllEvents: ["disconnect","accountsChanged"]',
	'disconnectAllEvents: ["disconnect"]',
];

describeVariants(
	"an Ethereum",
	variantsOf<EthereumBehavior>(ETHEREUM_BASELINE, {
		delivery: DELIVERIES,
		refusal: [
			{ message: "User rejected the request." },
			{ code: -32603, message: "Request cancelled" },
		],
		revoked: [
			"answers no account",
			{ code: 4100, message: "The requested account has not been authorized" },
		],
		disconnectAllEvents: [
			["accountsChanged", "disconnect"],
			["disconnect", "accountsChanged"],
			["disconnect"],
		],
		connectAllEvents: [
			["connect", "accountsChanged"],
			["accountsChanged", "connect"],
		],
		approvalEvents: [
			[],
			["connect", "accountsChanged"],
			["accountsChanged", "connect"],
		],
		accountsChangedFromAnswers: [true],
		authorizesBeforeAccounts: [true],
	}),
	ethereumScenarios,
	{
		"a Disconnect All in the wallet": {
			issue: 201,
			variants: DISCONNECT_EVENT_FIRST,
		},
		"a Disconnect All, then a Connect All in the wallet": {
			issue: 201,
			variants: [
				'disconnectAllEvents: ["accountsChanged","disconnect"]',
				...DISCONNECT_EVENT_FIRST,
			],
		},
		"a reload after a Disconnect All in the wallet": REVOKED_RELOAD,
	},
);

describeVariants(
	"a Solana",
	variantsOf<SolanaBehavior>(SOLANA_BASELINE, {
		delivery: DELIVERIES,
		refusal: ["Rejected", "Connection cancelled"],
		shows: ["authorized accounts"],
		changeOnConnect: ["after resolving", "never"],
		changeOnDisconnect: ["after resolving", "never"],
		disconnectRevokes: [false],
	}),
	(behavior) =>
		scenarios({
			install: () => installSolanaWallet({ name: "Wallet" }, behavior),
			platforms: [solana()],
			alice: "Alice",
			bob: "Bob",
		}).scenarios,
	{
		"a connect the user approves": {
			issue: 202,
			variants: ['changeOnConnect: "after resolving"'],
		},
		"a disconnect from the app": {
			issue: 197,
			except: [
				'changeOnDisconnect: "after resolving"',
				'changeOnDisconnect: "never"',
			],
		},
		"a reload after a Disconnect All in the wallet": REVOKED_RELOAD,
	},
);

describe("kheopskit$ shows each wallet the same with other wallets installed, whatever order their answers arrive in", () => {
	const LATENCIES = [0, 30, 120, 250];
	const rotations = LATENCIES.map((_, shift) => ({
		latencies: LATENCIES.map(
			(_, i) => LATENCIES[(i + shift) % LATENCIES.length] ?? 0,
		),
	}));
	const installSiblings = ([a = 0, b = 0, c = 0, d = 0]: number[]) => [
		{
			wallet: installPolkadotWallet(
				{ name: "Wallet A" },
				{ ...POLKADOT_BASELINE, delivery: { latencyMs: a } },
			),
			account: "Alice",
			switchTo: "Bob" as const,
			switched: "Bob",
		},
		{
			wallet: installEthereumWallet(
				{ name: "Wallet B" },
				{ ...ETHEREUM_BASELINE, delivery: { latencyMs: b } },
			),
			account: "Alice @1",
			switchTo: "Bob" as const,
			switched: "Bob @1",
		},
		{
			wallet: installEthereumWallet(
				{ name: "Wallet C", accounts: ["Bob"] },
				{
					...ETHEREUM_BASELINE,
					delivery: { latencyMs: c },
					authorizesBeforeAccounts: true,
				},
			),
			account: "Bob @1",
			switchTo: "Alice" as const,
			switched: "Alice @1",
		},
		{
			wallet: installSolanaWallet(
				{ name: "Wallet D" },
				{ ...SOLANA_BASELINE, delivery: { latencyMs: d } },
			),
			account: "Alice",
			switchTo: "Bob" as const,
			switched: "Bob",
		},
	];
	const loadPage = () =>
		openPage(storage, { platforms: [polkadot(), ethereum(), solana()] });
	const connectEach = async (
		page: Page,
		siblings: { wallet: FakeWallet }[],
	) => {
		for (const { wallet } of siblings)
			await page.framesDuring(() => page.wallet(wallet.label).connect());
	};

	it.each(rotations)(
		"a connect of each wallet in turn leaves the others as they were (latencies $latencies ms)",
		async ({ latencies }) => {
			const siblings = installSiblings(latencies);
			const page = loadPage();
			await settle();
			for (const { wallet, account } of siblings) {
				const before = siblings.map((s) =>
					shownOf(s.wallet.label, page.frames).at(-1),
				);
				const frames = await page.framesDuring(() =>
					page.wallet(wallet.label).connect(),
				);
				for (const [i, sibling] of siblings.entries())
					expect(shownOf(sibling.wallet.label, frames)).toEqual(
						sibling.wallet === wallet
							? ["connecting", `connected: ${account}`]
							: [before[i]],
					);
			}
			expectSteadyFrames(page.frames);
		},
	);

	it.each(rotations)(
		"a reload shows each wallet from the cache, then live, on its own (latencies $latencies ms)",
		async ({ latencies }) => {
			const siblings = installSiblings(latencies);
			const first = loadPage();
			await connectEach(first, siblings);
			first.close();
			const page = loadPage();
			await settle();

			expectSteadyFrames(page.frames);
			for (const { wallet, account } of siblings)
				expect(shownOf(wallet.label, page.frames)).toEqual([
					`connecting: ${account} (cached)`,
					`connected: ${account}`,
				]);
			expect(siblings.map(({ wallet }) => wallet.promptsShown())).toEqual([
				1, 1, 1, 1,
			]);
		},
	);

	it.each(rotations)(
		"an account switch in one wallet emits one frame that changes that wallet only (latencies $latencies ms)",
		async ({ latencies }) => {
			const siblings = installSiblings(latencies);
			const page = loadPage();
			await connectEach(page, siblings);
			for (const { wallet, switchTo, switched } of siblings) {
				const frames = await page.framesDuring(() =>
					wallet.setAccounts([switchTo]),
				);
				expect(frames).toHaveLength(1);
				expect(shownOf(wallet.label, frames)).toEqual([
					`connected: ${switched}`,
				]);
			}
			expectSteadyFrames(page.frames);
		},
	);
});
