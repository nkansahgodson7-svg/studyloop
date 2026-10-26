import type { Metadata, Viewport } from 'next';

import { AppShell } from "@/components/AppShell";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: 'StudyLoop — AI study loops',
    template: '%s — StudyLoop'
  },
  description: 'StudyLoop — turn your notes into answers, flashcards, and a daily review loop.'
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#F5F1E8',
  viewportFit: 'cover'
};

export default function RootLayout({
  children
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <div className="frame" aria-hidden="true" />
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
