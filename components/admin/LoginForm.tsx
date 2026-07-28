'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Loader2 } from 'lucide-react';

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get('next') ?? '/admin';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? 'Sign in failed');
        return;
      }
      // Only follow same-origin internal paths, so `next` can't be used to
      // bounce a freshly authenticated user to an attacker's site.
      const safeNext = /^\/(admin|pilot)(\/|$|\?)/.test(next) ? next : '/admin';
      router.replace(safeNext);
      router.refresh();
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-6 space-y-4">
      <div>
        <label className="text-sm font-medium">Email</label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          autoComplete="username"
          className="mt-2 w-full rounded-xl border bg-white px-4 py-3 text-sm outline-none focus:border-brand-400 dark:bg-white/5"
        />
      </div>
      <div>
        <label className="text-sm font-medium">Password</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          autoComplete="current-password"
          className="mt-2 w-full rounded-xl border bg-white px-4 py-3 text-sm outline-none focus:border-brand-400 dark:bg-white/5"
        />
      </div>
      {error && <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-600 dark:bg-red-950/30">{error}</p>}
      <button
        type="submit"
        disabled={loading}
        className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-full bg-brand-600 text-sm font-medium text-white transition-all hover:bg-brand-700 disabled:opacity-50"
      >
        {loading && <Loader2 className="h-4 w-4 animate-spin" />} Sign in
      </button>
    </form>
  );
}
