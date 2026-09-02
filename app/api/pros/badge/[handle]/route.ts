import { badgeSvg } from '@/lib/pros/badge';
import { prisma, isDbConfigured } from '@/lib/db';

export const runtime = 'nodejs';

/**
 * The printable QR for one pro's badge, as SVG.
 *
 * Served rather than stored because a QR is a pure function of a URL, and the
 * URL is a pure function of a handle that never changes. Caching an image of
 * it would only create a way for the picture and the destination to disagree.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;

  // Only issue codes for handles that exist. Otherwise anyone can mint a
  // convincing badge for a pro who never agreed to wear one.
  if (isDbConfigured && prisma) {
    const pro = await prisma.pro.findUnique({ where: { handle }, select: { status: true } });
    if (!pro || pro.status !== 'APPROVED') {
      return new Response('Not found', { status: 404 });
    }
  }

  const svg = await badgeSvg(handle);
  return new Response(svg, {
    headers: {
      'Content-Type': 'image/svg+xml',
      // A badge is printed once; the answer never changes for a given handle.
      'Cache-Control': 'public, max-age=86400',
      'Content-Disposition': `inline; filename="badge-${handle}.svg"`,
    },
  });
}
