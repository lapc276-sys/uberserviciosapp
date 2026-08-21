'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { LayoutDashboard, CalendarDays, Users, Settings, LogOut, ExternalLink, BarChart3, ScanEye, Megaphone, KeyRound, Timer } from 'lucide-react';
import { site } from '@/lib/config/site';

const nav = [
  { label: 'Dashboard', href: '/admin', icon: LayoutDashboard },
  { label: 'Bookings', href: '/admin/bookings', icon: CalendarDays },
  { label: 'Customers', href: '/admin/customers', icon: Users },
  { label: 'Analytics', href: '/admin/analytics', icon: BarChart3 },
  { label: 'AI Vision', href: '/admin/vision', icon: ScanEye },
  { label: 'Timings', href: '/admin/timings', icon: Timer },
  { label: 'Marketing', href: '/admin/marketing', icon: Megaphone },
  { label: 'Licensing', href: '/admin/tenants', icon: KeyRound },
  { label: 'Pros', href: '/admin/pros', icon: Settings },
];

export function AdminShell({
  user,
  children,
}: {
  user: { name?: string; email: string; role: string };
  children: React.ReactNode;
}) {
  const router = useRouter();

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.replace('/admin/login');
    router.refresh();
  }

  return (
    <div className="flex min-h-screen bg-slate-50 dark:bg-ink">
      <aside className="hidden w-60 shrink-0 flex-col border-r bg-white p-4 dark:bg-ink-soft lg:flex">
        <Link href="/" className="flex items-center gap-2 px-2 font-semibold">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand-600 text-white">H</span>
          {site.name}
        </Link>
        <nav className="mt-8 flex-1 space-y-1">
          {nav.map((n) => (
            <Link
              key={n.label}
              href={n.href}
              className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-white/5"
            >
              <n.icon className="h-4 w-4" /> {n.label}
            </Link>
          ))}
        </nav>
        <Link href="/" className="flex items-center gap-2 rounded-xl px-3 py-2 text-xs text-slate-400 hover:text-slate-600">
          <ExternalLink className="h-3.5 w-3.5" /> View public site
        </Link>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 items-center justify-between border-b bg-white px-6 dark:bg-ink-soft">
          <div className="flex items-center gap-2 lg:hidden">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand-600 text-white">H</span>
            <span className="font-semibold">{site.name}</span>
          </div>
          <div className="ml-auto flex items-center gap-4">
            <div className="text-right">
              <p className="text-sm font-medium">{user.name ?? user.email}</p>
              <p className="text-xs text-slate-400">{user.role}</p>
            </div>
            <button
              onClick={logout}
              className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-white/5"
            >
              <LogOut className="h-4 w-4" /> Sign out
            </button>
          </div>
        </header>
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  );
}
