'use client';

import { useState } from 'react';
import { Loader2, ArrowRight } from 'lucide-react';

export function PayoutOnboarding({ disabled, resuming }: { disabled?: boolean; resuming?: boolean }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function start() {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/pros/payouts/onboard', { method: 'POST' });
      const data = await res.json();
      if (!res.ok || !data.url) {
        setError(data.error ?? 'Could not start payout setup.');
        return;
      }
      window.location.href = data.url;
    } catch {
      setError('Network error. Please try again.');
      setLoading(false);
    }
  }

  return (
    <div>
      {error && <p className="mb-3 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-600 dark:bg-red-950/30">{error}</p>}
      <button
        onClick={start}
        disabled={loading || disabled}
        className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-full bg-brand-600 text-sm font-medium text-white transition-all hover:bg-brand-700 disabled:opacity-50"
      >
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
        {resuming ? 'Continue setup' : 'Set up payouts'}
      </button>
    </div>
  );
}
