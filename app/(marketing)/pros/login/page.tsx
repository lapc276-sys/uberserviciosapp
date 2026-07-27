import type { Metadata } from 'next';
import Link from 'next/link';
import { buildMetadata } from '@/lib/seo';
import { ProLoginForm } from '@/components/pros/ProLoginForm';

export const metadata: Metadata = buildMetadata({
  title: 'Pro Sign In | Homigo',
  description: 'Sign in to see your job offers and schedule.',
  path: '/pros/login',
  noindex: true,
});

const ERRORS: Record<string, string> = {
  missing: 'That sign-in link was incomplete. Request a new one below.',
  invalid: 'That link has expired or isn’t valid. Links last 15 minutes.',
  used: 'That link was already used. Request a fresh one below.',
  unknown: 'We couldn’t find a pro account for that email.',
  not_approved: 'Your account isn’t approved for jobs yet — we’ll email you as soon as it is.',
};

export default async function ProLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const message = error ? ERRORS[error] ?? ERRORS.invalid : null;

  return (
    <section className="border-b">
      <div className="container grid min-h-[70vh] place-items-center py-16">
        <div className="w-full max-w-sm">
          <div className="rounded-3xl border bg-white p-8 shadow-lift dark:bg-ink-soft">
            <h1 className="text-xl font-semibold">Pro sign in</h1>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              No password needed — we’ll send you a sign-in link.
            </p>
            {message && (
              <p className="mt-4 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
                {message}
              </p>
            )}
            <ProLoginForm />
          </div>
          <p className="mt-6 text-center text-sm text-slate-500 dark:text-slate-400">
            Not a Homigo Pro yet?{' '}
            <Link href="/pros/apply" className="text-brand-600 underline">Apply to join</Link>
          </p>
        </div>
      </div>
    </section>
  );
}
