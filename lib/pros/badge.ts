import QRCode from 'qrcode';
import { site } from '@/lib/config/site';

/**
 * The badge a cleaner wears, and the code on it.
 *
 * The cheapest acquisition channel this business has: somebody is already
 * standing in a building, visibly doing the work, in front of neighbours who
 * have the same floors. A code on their back is a billboard that walks itself
 * to the customer.
 *
 * Two constraints shape everything here, and both come from the code being
 * PRINTED rather than displayed.
 */

/**
 * A handle is permanent.
 *
 * Once a QR is on fabric it cannot be reissued — a pro who changes their name,
 * or leaves and comes back, keeps the handle that is already on the shirt.
 * Treat this as write-once.
 */
/**
 * Kept short because the QR encodes the whole URL: fewer characters means
 * fewer modules, larger squares, and a code that scans from across a corridor
 * instead of from arm's length.
 */
const MAX_HANDLE = 14;

export function handleFor(name: string, taken: Set<string>): string {
  const words = name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

  // Whole words only, up to the limit. Cutting mid-word gives handles like
  // "josemariaruizd", which reads as a typo — and this ends up printed on a
  // garment and read aloud down a phone.
  let base = '';
  for (const word of words) {
    if (base && base.length + word.length > MAX_HANDLE) break;
    base = (base + word).slice(0, MAX_HANDLE);
  }
  if (!base) base = 'pro';

  if (!taken.has(base)) return base;
  for (let n = 2; n < 100; n++) {
    const candidate = `${base}${n}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${base}${Date.now().toString(36).slice(-4)}`;
}

export function badgeUrl(handle: string): string {
  const base = (site.url ?? '').replace(/\/+$/, '');
  return `${base}/p/${handle}`;
}

/**
 * Renders the badge QR as SVG.
 *
 * Error correction is set to 'M' rather than the maximum on purpose. Higher
 * correction means more modules in the same square, and on a garment the
 * limiting factor is not damage tolerance — it is how small each module gets
 * before a phone at two metres, in a corridor, on a surface that creases,
 * stops resolving them. A short URL and fewer, larger modules scans from
 * further away than a dense code that could survive being torn.
 *
 * SVG rather than PNG because a badge gets printed at whatever size the
 * printer decides, and a raster QR blown up to A5 scans worse than one that
 * was never rasterised.
 */
export function badgeSvg(handle: string): Promise<string> {
  return QRCode.toString(badgeUrl(handle), {
    type: 'svg',
    errorCorrectionLevel: 'M',
    // One module of quiet zone is the minimum the spec allows; scanners need
    // the border to find the code at all.
    margin: 1,
    width: 512,
  });
}

/**
 * Printing guidance, kept next to the code that generates the thing.
 *
 * Written down because the failure it prevents is silent and expensive: a
 * hundred shirts that look right and do not scan.
 */
export const PRINT_NOTES = [
  'Imprime el QR en un parche rígido o una credencial, no directamente en tela elástica: al estirarse deja de leerse.',
  'Mínimo 4 cm de lado. Por debajo de eso hay que acercarse tanto que nadie lo hace.',
  'Negro sobre blanco. Los scanners buscan contraste, no colores de marca.',
  'Deja el borde blanco alrededor. Sin ese margen muchos lectores no encuentran el código.',
  'Prueba uno impreso, a dos metros, con la cámara normal del teléfono, antes de encargar cien.',
];
