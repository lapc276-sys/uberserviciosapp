import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SESSION_COOKIE, verifySessionToken } from '@/lib/auth';
import { AdminShell } from '@/components/admin/AdminShell';

/** Authenticated admin shell. Middleware already gates /admin, but we verify
 * again here so the layout has the session to render user + role. */
export default async function DashLayout({ children }: { children: React.ReactNode }) {
  const jar = await cookies();
  const session = await verifySessionToken(jar.get(SESSION_COOKIE)?.value);
  if (!session) redirect('/admin/login');

  return (
    <AdminShell user={{ name: session.name, email: session.email, role: session.role }}>
      {children}
    </AdminShell>
  );
}
