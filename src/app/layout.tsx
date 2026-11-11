import type { Metadata, Viewport } from 'next';
import { Analytics } from '@vercel/analytics/next';

import { AppShell } from "@/components/AppShell";
import { ServiceWorkerRegister } from "@/components/ServiceWorkerRegister";
// Self-hosted variable fonts (same-origin, no render-blocking third-party @import).
import "@fontsource-variable/inter";
import "@fontsource-variable/fraunces/opsz.css";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: 'StudyLoop — AI study loops',
    template: '%s — StudyLoop'
  },
  description: 'StudyLoop — turn your notes into answers, flashcards, and a daily review loop.',
  applicationName: 'StudyLoop',
  manifest: '/manifest.webmanifest',
  icons: {
    icon: [
      { url: '/icon.svg', type: 'image/svg+xml' },
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' }
    ],
    apple: [{ url: '/icons/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }]
  },
  appleWebApp: {
    capable: true,
    title: 'StudyLoop',
    statusBarStyle: 'default'
  },
  formatDetection: { telephone: false }
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#F5F1E8',
  colorScheme: 'light',
  viewportFit: 'cover',
  interactiveWidget: 'resizes-content'
};

// Analytics only exists on Vercel: the production script is served from
// /_vercel/insights and the dev debug script from va.vercel-scripts.com. Loading
// it anywhere else (plain `next dev` / `next start`) logs a CSP violation or a
// 404 on every page, which looks like the app itself is broken.
const analyticsEnabled = Boolean(process.env.VERCEL);

export default function RootLayout({
  children
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <div className="frame" aria-hidden="true" />
        <AppShell>{children}</AppShell>
        <ServiceWorkerRegister />
        {analyticsEnabled ? <Analytics /> : null}
      </body>
    </html>
  );
}
