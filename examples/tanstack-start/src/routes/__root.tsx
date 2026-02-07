import {
	createRootRoute,
	HeadContent,
	Outlet,
	Scripts,
} from "@tanstack/react-router";
import { Providers } from "../providers";
import appCss from "../styles.css?url";

export const Route = createRootRoute({
	component: RootComponent,
	head: () => ({
		meta: [
			{ charSet: "utf-8" },
			{ name: "viewport", content: "width=device-width, initial-scale=1" },
		],
		links: [{ rel: "stylesheet", href: appCss }],
	}),
});

function RootComponent() {
	return (
		<html lang="en" className="dark">
			<head>
				<HeadContent />
			</head>
			<body className="bg-background text-foreground">
				<Providers>
					<Outlet />
				</Providers>
				<Scripts />
			</body>
		</html>
	);
}
