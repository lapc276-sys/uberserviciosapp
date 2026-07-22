import type { Metadata } from 'next';
import { buildMetadata } from '@/lib/seo';
import { LegalPage } from '@/components/layout/LegalPage';
import { site } from '@/lib/config/site';

export const metadata: Metadata = buildMetadata({
  title: 'Privacy Policy | Homigo',
  description: 'How Homigo collects, uses and protects your information.',
  path: '/privacy',
  noindex: true,
});

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy" updated="July 2026">
      <p>
        This Privacy Policy explains how {site.legalName} (“{site.name}”, “we”, “us”) collects, uses, and
        protects information when you use our website and services. This is a template and should be reviewed
        by legal counsel before launch.
      </p>
      <h2>Information we collect</h2>
      <p>We collect information you provide when booking (name, contact details, service address, and service preferences), as well as usage data collected automatically to improve our services.</p>
      <h2>How we use information</h2>
      <p>To provide and schedule services, process payments, send confirmations and reminders, respond to inquiries, and improve our platform.</p>
      <h2>Sharing</h2>
      <p>We share information with service professionals to fulfill your booking and with processors (e.g., payment, messaging) strictly to operate the service. We do not sell your personal information.</p>
      <h2>Your choices</h2>
      <p>You may opt out of marketing messages at any time and request access to or deletion of your data by contacting {site.email}.</p>
      <h2>Contact</h2>
      <p>Questions? Email {site.email} or call {site.phone}.</p>
    </LegalPage>
  );
}
