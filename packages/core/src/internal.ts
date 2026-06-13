/**
 * Internal plumbing shared with `@kheopskit/react`. Not part of the public,
 * semver-stable API — import from `@kheopskit/core` (or a platform subpath)
 * instead. These exports may change in any release.
 *
 * @internal
 */
export { acceptsCachedAccount } from "./api/platform";
export {
	clearCachedObservable,
	clearCachedObservablesByPrefix,
} from "./utils/getCachedObservable";
export {
	hydrateAccount,
	hydrateWallet,
	serializeAccount,
	serializeWallet,
} from "./utils/hydrateState";
export { getCachedIcon, setCachedIcons } from "./utils/iconCache";
export { getSafeLocalStorage } from "./utils/storage";
