import { Navbar } from '@/components/layout/Navbar';
import { Footer } from '@/components/layout/Footer';
import { ChatWidget } from '@/components/chat/ChatWidget';
import { JsonLd } from '@/components/seo/JsonLd';
import { organizationSchema, localBusinessSchema } from '@/lib/schema';
import { Analytics } from '@/components/analytics/Analytics';

/**
 * Public marketing shell: global nav, footer and the AI chat widget.
 *
 * Our schema.org identity and analytics belong here rather than in the root
 * layout — these are the pages that are actually ours.
 */
export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <JsonLd data={[organizationSchema(), localBusinessSchema()]} />
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-brand-600 focus:px-4 focus:py-2 focus:text-white"
      >
        Skip to content
      </a>
      <Navbar />
      <main id="main">{children}</main>
      <Footer />
      <ChatWidget />
      <Analytics />
    </>
  );
}
