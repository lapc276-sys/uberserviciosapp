'use client';

import { useRouter } from 'next/navigation';
import { LogOut } from 'lucide-react';

export function ProSignOut() {
  const router = useRouter();

  async function signOut() {
    await fetch('/api/pros/auth/logout', { method: 'POST' });
    router.replace('/pros/login');
    router.refresh();
  }

  return (
    <button
      onClick={signOut}
      className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-white/5"
    >
      <LogOut className="h-4 w-4" /> Sign out
    </button>
  );
}
