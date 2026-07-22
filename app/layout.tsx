import type { Metadata, Viewport } from 'next';
import './globals.css';
import { buildMetadata } from '@/lib/seo';
import { JsonLd } from '@/components/seo/JsonLd';
import { organizationSchema, localBusinessSchema } from '@/lib/schema';
import { Analytics } from '@/components/analytics/Analytics';

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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
      </head>
      <body className="min-h-screen antialiased">
        <JsonLd data={[organizationSchema(), localBusinessSchema()]} />
        {children}
        <Analytics />
      </body>
    </html>
  );
}
