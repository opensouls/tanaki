import { HeadContent, Scripts, createRootRoute } from '@tanstack/react-router'
import '@radix-ui/themes/styles.css'
import { Box, Button, Theme } from '@radix-ui/themes'
import { Suspense, lazy } from 'react'

import { ClientOnly } from '../components/ClientOnly'

import appCss from '../styles.css?url'

const DevtoolsClient = lazy(() => import('../components/DevtoolsClient'))

export const Route = createRootRoute({
  head: () => ({
    meta: [
      {
        charSet: 'utf-8',
      },
      {
        name: 'viewport',
        content: 'width=device-width, initial-scale=1',
      },
      {
        title: 'Tanaki',
      },
    ],
    links: [
      {
        rel: 'stylesheet',
        href: appCss,
      },
    ],
  }),

  shellComponent: RootDocument,
  notFoundComponent: NotFound,
})

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark-theme dark" style={{ colorScheme: 'dark' }}>
      <head>
        <HeadContent />
      </head>
      <body>
        <Theme
          appearance="dark"
          accentColor="iris"
          grayColor="slate"
          panelBackground="solid"
          radius="small"
        >
          {children}
        </Theme>
        <ClientOnly>
          <Suspense fallback={null}>
            <DevtoolsClient />
          </Suspense>
        </ClientOnly>
        <Scripts />
      </body>
    </html>
  )
}

function NotFound() {
  return (
    <Box className="min-h-screen flex flex-col items-center justify-center gap-4 p-6">
      <Box className="text-center">
        <h1 className="text-2xl font-semibold">Not Found</h1>
        <p className="text-sm opacity-80">That page doesn’t exist.</p>
      </Box>
      <Button asChild>
        <a href="/">Go home</a>
      </Button>
    </Box>
  )
}
