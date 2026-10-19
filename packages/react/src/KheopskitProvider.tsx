import {
	createKheopskit,
	type KheopskitConfig,
	type KheopskitPlatform,
	type KheopskitStore,
} from "@kheopskit/core";
import {
	type FC,
	type PropsWithChildren,
	useEffect,
	useMemo,
	useRef,
} from "react";
import { KheopskitSourceProvider } from "./KheopskitSourceProvider";

export type KheopskitProviderProps = PropsWithChildren & {
	/**
	 * Kheopskit configuration.
	 *
	 * @remarks
	 * Must be a **referentially stable** value — define it once (module scope, a
	 * `useMemo`, or via {@link createKheopskit}) and pass the same reference. A
	 * new object literal on every render (`config={{ platforms: [...] }}` inline)
	 * recreates the underlying store and re-subscribes each render.
	 */
	config?: Partial<KheopskitConfig>;
	/**
	 * The kheopskit cookie, for SSR hydration. Pass only the cookie named after
	 * `storageKey` (default `kheopskit`), or `""` when it is absent. Never pass
	 * the whole cookie header: props of a client component are serialized into
	 * the HTML, httpOnly session cookies included.
	 *
	 * @remarks
	 * This value should be stable per render to avoid unnecessary store recreation.
	 * Compute it once in your server component or layout and pass it down.
	 *
	 * @example
	 * ```tsx
	 * // Next.js App Router
	 * const kheopskitCookie = (await cookies()).get("kheopskit");
	 * const ssrCookies = kheopskitCookie
	 *   ? `kheopskit=${encodeURIComponent(kheopskitCookie.value)}`
	 *   : "";
	 * return <Providers ssrCookies={ssrCookies}>{children}</Providers>
	 * ```
	 */
	ssrCookies?: string;
	/**
	 * Store the provider reads the cache from and persists into, on the client.
	 * Defaults to a store per mount, backed by cookies when `ssrCookies` is set
	 * and by localStorage otherwise. The server snapshot always comes from
	 * `ssrCookies`.
	 *
	 * @example
	 * ```tsx
	 * // tests
	 * const store = createKheopskitStore({ storage: createMemoryStorage() });
	 * render(<KheopskitProvider config={config} store={store}>…</KheopskitProvider>);
	 * ```
	 */
	store?: KheopskitStore;
};

export const KheopskitProvider: FC<KheopskitProviderProps> = ({
	children,
	config,
	ssrCookies,
	store,
}) => {
	// Dev-only: warn if the `config` prop reference changes between renders. A new
	// object each render recreates the store and re-subscribes the whole pipeline
	// (re-hydrating, dropping live connection state) on every render. `config` must
	// be referentially stable — define it at module scope, memoize it, or use
	// createKheopskit() (which passes a stable reference for you).
	const lastConfigRef = useRef(config);
	const hasMountedRef = useRef(false);
	useEffect(() => {
		if (
			hasMountedRef.current &&
			lastConfigRef.current !== config &&
			(typeof process === "undefined" || process.env?.NODE_ENV !== "production")
		) {
			console.warn(
				"[kheopskit] KheopskitProvider received a new `config` reference; this " +
					"recreates the store and re-subscribes on every render. Pass a " +
					"referentially stable config (module scope, useMemo, or createKheopskit()).",
			);
		}
		hasMountedRef.current = true;
		lastConfigRef.current = config;
	}, [config]);

	const ssr = ssrCookies !== undefined;
	const kit = useMemo(
		() =>
			createKheopskit(
				{
					...config,
					platforms: (config?.platforms ?? []) as readonly [KheopskitPlatform],
				},
				store ? { store } : { ssr },
			),
		[config, store, ssr],
	);

	return (
		<KheopskitSourceProvider kit={kit} config={config} ssrCookies={ssrCookies}>
			{children}
		</KheopskitSourceProvider>
	);
};
