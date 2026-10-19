import type { Metadata } from "next";
import { cookies } from "next/headers";
import { App } from "./app";
import "./globals.css";

export const metadata: Metadata = {
	title: "Kheopskit Next.js Playground",
	description: "Library for connecting dapps to multiple platforms & wallets",
	icons: {
		icon: "/kheopskit-square.svg",
	},
};

export default async function RootLayout({
	children,
}: Readonly<{
	children: React.ReactNode;
}>) {
	const kheopskitCookie = (await cookies()).get("kheopskit");
	const ssrCookies = kheopskitCookie
		? `kheopskit=${encodeURIComponent(kheopskitCookie.value)}`
		: "";

	return (
		<html lang="en" className="dark">
			<body>
				<App ssrCookies={ssrCookies}>{children}</App>
			</body>
		</html>
	);
}
