import {
	createRootRoute,
	HeadContent,
	Outlet,
	Scripts,
} from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { App } from "../app";
import appCss from "../styles.css?url";

const getSSRCookies = createServerFn({ method: "GET" }).handler(async () => {
	const request = getRequest();
	return request?.headers.get("cookie") ?? "";
});

export const Route = createRootRoute({
	component: RootComponent,
	head: () => ({
		meta: [
			{ charSet: "utf-8" },
			{ name: "viewport", content: "width=device-width, initial-scale=1" },
		],
		links: [
			{ rel: "stylesheet", href: appCss },
			{ rel: "icon", type: "image/svg+xml", href: "/kheopskit-square.svg" },
		],
	}),
	loader: async () => {
		const ssrCookies = await getSSRCookies();
		return { ssrCookies };
	},
});

function RootComponent() {
	const { ssrCookies } = Route.useLoaderData();

	return (
		<html lang="en" className="dark">
			<head>
				<HeadContent />
			</head>
			<body className="bg-background text-foreground">
				<App ssrCookies={ssrCookies}>
					<Outlet />
				</App>
				<Scripts />
			</body>
		</html>
	);
}
