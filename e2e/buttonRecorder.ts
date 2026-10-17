import type { Page } from "@playwright/test";

// The Connecting… window is shorter than a locator poll under load, so the
// row's button is sampled every animation frame and the sequence read back.
export const BUTTON_RECORDER = `
(() => {
  const samples = [];
  window.__buttonSamples = samples;
  const tick = () => {
    const row = Array.from(document.querySelectorAll("tbody tr")).find((tr) =>
      (tr.textContent || "").includes("mock-polkadot-wallet") && tr.querySelector("button"),
    );
    const button = row && row.querySelector("button");
    samples.push(
      button
        ? (button.textContent || "").trim() + (button.disabled ? " (disabled)" : "")
        : null,
    );
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
})();
`;

/** The distinct button labels seen so far, a disabled button suffixed " (disabled)". */
export const buttonSequence = (page: Page): Promise<string[]> =>
	page.evaluate(() =>
		(
			window as unknown as { __buttonSamples: (string | null)[] }
		).__buttonSamples
			.filter((label): label is string => label !== null)
			.filter((label, i, all) => i === 0 || label !== all[i - 1]),
	);
