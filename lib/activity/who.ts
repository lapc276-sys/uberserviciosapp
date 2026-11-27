import { cookies } from 'next/headers';
import { PRO_SESSION_COOKIE, verifyProSession } from '../pro-auth';
import { SESSION_COOKIE, verifySessionToken } from '../auth';

/**
 * Who is logging time or recording a job — from the session cookie, never
 * from the request body. Time and video are the asset here, and an identity
 * the phone could send would let anyone write rows against anyone's name.
 */
export interface Who {
  loggedBy: string;
  proId?: string;
  email: string;
  name?: string;
}

export async function whoIsLogging(): Promise<Who | null> {
  const jar = await cookies();
  const [pro, admin] = await Promise.all([
    verifyProSession(jar.get(PRO_SESSION_COOKIE)?.value),
    verifySessionToken(jar.get(SESSION_COOKIE)?.value),
  ]);
  if (pro?.email) return { loggedBy: pro.email, proId: pro.proId, email: pro.email, name: pro.name };
  if (admin?.email) return { loggedBy: admin.email, email: admin.email };
  return null;
}
