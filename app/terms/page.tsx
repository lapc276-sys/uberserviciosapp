import type { Metadata } from 'next';
import { buildMetadata } from '@/lib/seo';
import { LegalPage } from '@/components/layout/LegalPage';
import { site } from '@/lib/config/site';

export const metadata: Metadata = buildMetadata({
  title: 'Terms of Service | Homigo',
  description: 'The terms that govern your use of Homigo services.',
  path: '/terms',
  noindex: true,
});

export default function TermsPage() {
  return (
    <LegalPage title="Terms of Service" updated="July 2026">
      <p>
        These Terms govern your use of {site.legalName} (“{site.name}”) services. By booking, you agree to
        them. This is a template and should be reviewed by legal counsel before launch.
      </p>
      <h2>Services</h2>
      <p>{site.name} connects you with vetted, insured cleaning professionals. Prices shown are estimates that may adjust based on actual home condition and scope.</p>
      <h2>Bookings & payment</h2>
      <p>Payment is authorized at booking and charged after service completion. Recurring plans continue until canceled.</p>
      <h2>Cancellations</h2>
      <p>You may reschedule or cancel free of charge up to 24 hours before your appointment. Late cancellations may incur a fee.</p>
      <h2>Satisfaction guarantee</h2>
      <p>If you’re not satisfied, notify us within 24 hours and we’ll re-clean the affected areas at no additional cost.</p>
      <h2>Liability</h2>
      <p>Our liability is limited to the amount paid for the affected service, to the extent permitted by law.</p>
      <h2>Contact</h2>
      <p>Questions about these Terms? Email {site.email}.</p>
    </LegalPage>
  );
}
