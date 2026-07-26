import type { Metadata } from 'next';
import { buildMetadata } from '@/lib/seo';
import { unsubscribe } from '@/lib/data';
import { Button } from '@/components/ui/Button';
import { site } from '@/lib/config/site';

export const metadata: Metadata = buildMetadata({
  title: 'Unsubscribe | Homigo',
  description: 'Manage your email preferences.',
  path: '/unsubscribe',
  noindex: true,
});

export const dynamic = 'force-dynamic';

/**
 * One-click opt-out target for the CAN-SPAM footer link. Processes the
 * unsubscribe on load so the recipient never has to fill in a form.
 */
export default async function UnsubscribePage({
  searchParams,
}: {
  searchParams: Promise<{ e?: string }>;
}) {
  const { e } = await searchParams;
  const email = e?.trim().toLowerCase();
  const valid = Boolean(email && /.+@.+\..+/.test(email));
  if (valid) await unsubscribe(email!);

  return (
    <section className="border-b">
      <div className="container flex min-h-[60vh] flex-col items-center justify-center py-20 text-center">
        {valid ? (
          <>
            <h1 className="text-3xl font-semibold tracking-tight">You’re unsubscribed</h1>
            <p className="mt-3 max-w-md text-slate-600 dark:text-slate-300">
              <span className="font-medium">{email}</span> won’t receive promotional emails from {site.name} anymore.
              You’ll still get booking confirmations and service reminders.
            </p>
          </>
        ) : (
          <>
            <h1 className="text-3xl font-semibold tracking-tight">Manage email preferences</h1>
            <p className="mt-3 max-w-md text-slate-600 dark:text-slate-300">
              We couldn’t read an email address from that link. Email{' '}
              <a href={`mailto:${site.email}`} className="text-brand-600 underline">{site.email}</a> and we’ll take care of it right away.
            </p>
          </>
        )}
        <div className="mt-8">
          <Button href="/">Back to home</Button>
        </div>
      </div>
    </section>
  );
}
