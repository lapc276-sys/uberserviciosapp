import { notFound } from 'next/navigation';
import Link from 'next/link';
import { Camera, MapPin, ShieldCheck } from 'lucide-react';
import { prisma, isDbConfigured } from '@/lib/db';
import { badgeUrl } from '@/lib/pros/badge';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Where a scanned badge lands.
 *
 * Somebody in a corridor pointed a phone at a cleaner's back. They have about
 * five seconds of attention and one question: can this person clean my place.
 * So the page is a name, a photo, and a camera button — no navigation, no
 * marketing, nothing to read.
 *
 * What is deliberately NOT here matters as much. No surname, no phone, no
 * email, no schedule, no home city. Most of the people wearing these badges
 * are women who work alone in strangers' houses, and a code on their back that
 * resolves to a way of contacting them personally is a safety problem dressed
 * up as a feature. Everything routes through the platform.
 */

interface Props {
  params: Promise<{ handle: string }>;
}

export async function generateMetadata({ params }: Props) {
  const { handle } = await params;
  return {
    title: `Presupuesto en 2 minutos`,
    alternates: { canonical: badgeUrl(handle) },
    // A badge is scanned, never searched for. Indexing these adds thin pages
    // to the site and puts a worker's profile into search results, which is
    // the opposite of what the privacy note above is protecting.
    robots: { index: false, follow: false },
  };
}

export default async function ProBadgePage({ params }: Props) {
  const { handle } = await params;

  if (!isDbConfigured || !prisma) notFound();

  const pro = await prisma.pro.findUnique({
    where: { handle },
    select: { id: true, name: true, handle: true, rating: true, acceptingWork: true, serviceAreas: true, status: true },
  });

  // Same answer for "no such handle" and "not approved": a handle is public
  // and printed, so confirming which ones exist invites enumeration.
  if (!pro || pro.status !== 'APPROVED') notFound();

  const firstName = pro.name.split(' ')[0];

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 px-5 py-10">
      <div className="text-center">
        <div className="mx-auto grid h-20 w-20 place-items-center rounded-full bg-brand-50 text-2xl font-semibold text-brand-700 dark:bg-brand-950/40">
          {firstName.slice(0, 1).toUpperCase()}
        </div>
        <h1 className="mt-4 text-2xl font-semibold">{firstName}</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Limpieza profesional</p>

        {pro.serviceAreas.length > 0 && (
          <p className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1 text-xs dark:bg-white/10">
            <MapPin className="h-3.5 w-3.5" />
            {pro.serviceAreas.length === 1 ? 'Zona' : 'Zonas'}: {pro.serviceAreas.join(' · ')}
          </p>
        )}
      </div>

      {/* The whole page exists for this button. */}
      <Link
        href={`/quote/video?ref=${pro.handle}`}
        className="inline-flex min-h-[64px] w-full items-center justify-center gap-2 rounded-2xl bg-brand-600 text-lg font-semibold text-white"
      >
        <Camera className="h-6 w-6" /> Pide tu precio en 2 minutos
      </Link>

      <p className="text-center text-sm text-slate-500 dark:text-slate-400">
        Graba tu casa con el móvil siguiendo las instrucciones y recibes un precio al instante. Sin
        visita previa, sin descargar nada.
      </p>

      {!pro.acceptingWork && (
        // Said plainly rather than hidden. Somebody who scanned a specific
        // person's badge should be told they will get somebody else, not
        // discover it when a stranger arrives.
        <p className="rounded-xl bg-amber-50 p-3 text-center text-sm text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
          {firstName} tiene la agenda llena ahora mismo. Te pasamos con otra persona del equipo —
          igual de verificada, y {firstName} recibe el crédito por la recomendación.
        </p>
      )}

      <p className="flex items-center justify-center gap-1.5 text-xs text-slate-400">
        <ShieldCheck className="h-3.5 w-3.5" /> Todo el contacto va por la plataforma
      </p>
    </main>
  );
}
