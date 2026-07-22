import { Suspense } from 'react';
import type { Metadata } from 'next';
import { buildMetadata } from '@/lib/seo';
import { LoginForm } from '@/components/admin/LoginForm';

export const metadata: Metadata = buildMetadata({ title: 'Admin Sign In | Homigo', path: '/admin/login', noindex: true });

export default function LoginPage() {
  return (
    <div className="grid min-h-screen place-items-center bg-slate-50 p-6 dark:bg-ink">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center justify-center gap-2 font-semibold">
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-brand-600 text-white">H</span>
          <span className="text-lg">Homigo Admin</span>
        </div>
        <div className="rounded-3xl border bg-white p-8 shadow-lift dark:bg-ink-soft">
          <h1 className="text-xl font-semibold">Sign in</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Access the operations dashboard.</p>
          <Suspense fallback={<div className="mt-6 h-40" />}>
            <LoginForm />
          </Suspense>
        </div>
        <p className="mt-6 text-center text-xs text-slate-400">Protected area · authorized staff only</p>
      </div>
    </div>
  );
}
