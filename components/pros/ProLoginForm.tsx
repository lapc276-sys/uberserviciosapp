'use client';

import { useState } from 'react';
import { Loader2, MailCheck } from 'lucide-react';

export function ProLoginForm() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/pros/auth/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Something went wrong.');
        return;
      }
      setSent(true);
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  if (sent) {
    return (
      <div className="mt-6 rounded-2xl bg-emerald-50 p-5 text-center dark:bg-emerald-950/30">
        <MailCheck className="mx-auto h-6 w-6 text-emerald-600" />
        <p className="mt-2 font-medium text-emerald-900 dark:text-emerald-200">Check your phone and email</p>
        <p className="mt-1 text-sm text-emerald-800/80 dark:text-emerald-300/80">
          If that address belongs to an approved pro, your sign-in link is on its way. It expires in 15 minutes.
        </p>
      </div>
    );
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
          autoComplete="email"
          className="mt-2 w-full rounded-xl border bg-white px-4 py-3 text-sm outline-none focus:border-brand-400 dark:bg-white/5"
        />
      </div>
      {error && <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-600 dark:bg-red-950/30">{error}</p>}
      <button
        type="submit"
        disabled={loading}
        className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-full bg-brand-600 text-sm font-medium text-white transition-all hover:bg-brand-700 disabled:opacity-50"
      >
        {loading && <Loader2 className="h-4 w-4 animate-spin" />} Send sign-in link
      </button>
    </form>
  );
}
