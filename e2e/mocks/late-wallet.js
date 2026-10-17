(() => {
	const LATE_WALLET = "late-mock-wallet";
	const DISCOVERING_TEXT = "Looking for wallets…";
	const INJECT_AFTER_FIRST_READ_MS = 1500;
	const DOT_ADDRESS = "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY";
	const DOT_SIGNATURE = `0x${"22".repeat(64)}`;
	const lateAccounts = [
		{ address: DOT_ADDRESS, name: "Late Mock Account", type: "sr25519" },
	];

	const marks = {
		registryReads: [],
		dcl: null,
		injected: null,
		load: null,
		discoveringAtLoad: null,
		discoveringFirstSeen: null,
		discoveringGone: null,
		lateRowFirstSeen: null,
	};
	window.__discoveryMarks = marks;

	const injectLateWallet = () => {
		registry[LATE_WALLET] = {
			version: "1.0.0",
			enable: async () => ({
				accounts: {
					get: async () => lateAccounts,
					subscribe: (cb) => {
						cb(lateAccounts);
						return () => {};
					},
				},
				signer: {
					signRaw: async () => ({ id: 1, signature: DOT_SIGNATURE }),
					signPayload: async () => ({ id: 1, signature: DOT_SIGNATURE }),
				},
			}),
		};
		marks.injected = performance.now();
	};

	let registry = window.injectedWeb3 || {};
	Object.defineProperty(window, "injectedWeb3", {
		configurable: true,
		get: () => {
			marks.registryReads.push(performance.now());
			if (marks.registryReads.length === 1)
				setTimeout(injectLateWallet, INJECT_AFTER_FIRST_READ_MS);
			return registry;
		},
		set: (value) => {
			registry = value;
		},
	});

	const isDiscovering = () =>
		Array.from(document.querySelectorAll("p")).some(
			(p) => p.textContent === DISCOVERING_TEXT,
		);

	const lateRowVisible = () => {
		for (const table of document.querySelectorAll("table")) {
			const headers = Array.from(table.querySelectorAll("th")).map((th) =>
				(th.textContent || "").trim(),
			);
			if (!headers.includes("Accounts")) continue;
			return Array.from(table.querySelectorAll("tbody tr")).some((row) =>
				(row.textContent || "").includes(LATE_WALLET),
			);
		}
		return false;
	};

	const record = () => {
		const now = performance.now();
		const discovering = isDiscovering();
		if (discovering && marks.discoveringFirstSeen === null)
			marks.discoveringFirstSeen = now;
		if (
			!discovering &&
			marks.discoveringFirstSeen !== null &&
			marks.discoveringGone === null
		)
			marks.discoveringGone = now;
		if (marks.lateRowFirstSeen === null && lateRowVisible())
			marks.lateRowFirstSeen = now;
	};

	new MutationObserver(record).observe(document, {
		childList: true,
		subtree: true,
		characterData: true,
	});

	document.addEventListener("DOMContentLoaded", () => {
		marks.dcl = performance.now();
		record();

		const holdLoad = document.createElement("img");
		holdLoad.src = "/kheopskit-square.svg?hold-load";
		holdLoad.alt = "";
		holdLoad.style.cssText =
			"position:absolute;left:-9999px;width:1px;height:1px";
		document.body.append(holdLoad);
	});

	window.addEventListener("load", () => {
		marks.load = performance.now();
		marks.discoveringAtLoad = isDiscovering();
	});
})();
