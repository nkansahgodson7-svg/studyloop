import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'StudyLoop',
  description: 'Chat with your sources, make cards, never forget'
};

export default function RootLayout({
  children
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
