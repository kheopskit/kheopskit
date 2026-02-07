import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Providers } from "./providers";
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
	const cookieStore = await cookies();
	const ssrCookies = cookieStore
		.getAll()
		.map((c) => `${c.name}=${c.value}`)
		.join("; ");

	return (
		<html lang="en" className="dark">
			<body>
				<Providers ssrCookies={ssrCookies}>{children}</Providers>
			</body>
		</html>
	);
}
