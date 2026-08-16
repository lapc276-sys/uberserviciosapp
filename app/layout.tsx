import type { Metadata, Viewport } from 'next';
import './globals.css';
import { buildMetadata } from '@/lib/seo';

export const metadata: Metadata = buildMetadata();

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#0a0a0b' },
  ],
  width: 'device-width',
  initialScale: 1,
};

const themeInit = `
try {
  var t = localStorage.getItem('theme');
  if (t === 'dark' || (!t && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
    document.documentElement.classList.add('dark');
  }
} catch (e) {}
`;

/**
 * Root shell only.
 *
 * Our organisation schema and our analytics used to live here, which meant
 * they were injected into every page in the app — including the quoting pages
 * we host for other companies. Their customers were being told, in structured
 * data, that the page belonged to us, and were being tracked by our pixel.
 * Both now live in the marketing layout, where the claim is actually true.
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
      </head>
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
