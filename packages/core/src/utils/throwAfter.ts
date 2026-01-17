export const throwAfter = (ms: number, message?: string) =>
	new Promise<never>((_, reject) => {
		setTimeout(() => {
			reject(new Error(message ?? "Timeout"));
		}, ms);
	});
