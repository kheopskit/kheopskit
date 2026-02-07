import { createRootRoute, HeadContent, Outlet, Scripts } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { getWebRequest } from '@tanstack/react-start/server'
import { Providers } from '../providers'
import appCss from '../styles.css?url'

const getSSRCookies = createServerFn({ method: 'GET' }).handler(async () => {
	const request = getWebRequest()
	return request?.headers.get('cookie') ?? ''
})

export const Route = createRootRoute({
	component: RootComponent,
	head: () => ({
		meta: [
			{ charSet: 'utf-8' },
			{ name: 'viewport', content: 'width=device-width, initial-scale=1' },
		],
		links: [{ rel: 'stylesheet', href: appCss }],
	}),
	loader: async () => {
		const ssrCookies = await getSSRCookies()
		return { ssrCookies }
	},
})

function RootComponent() {
	const { ssrCookies } = Route.useLoaderData()

	return (
		<html lang="en" className="dark">
			<head>
				<HeadContent />
			</head>
			<body className="bg-background text-foreground">
				<Providers ssrCookies={ssrCookies}>
					<Outlet />
				</Providers>
				<Scripts />
			</body>
		</html>
	)
}
