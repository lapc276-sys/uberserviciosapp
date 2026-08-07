import type { LatLng } from './types';

/**
 * Address → coordinates, env-gated like every other integration here.
 *
 * Without GOOGLE_MAPS_API_KEY this returns null and the order is still created:
 * a laundry pickup with no coordinates is a dispatch problem, not a reason to
 * drop a customer who just texted you. The admin can pin it, or the courier's
 * first arrival supplies the point.
 */
export const isGeocodingConfigured = Boolean(process.env.GOOGLE_MAPS_API_KEY);

export interface GeocodeResult {
  location: LatLng;
  formatted: string;
  /** ROOFTOP | RANGE_INTERPOLATED | GEOMETRIC_CENTER | APPROXIMATE */
  precision: string;
}

export async function geocodeAddress(address: string, region = 'us'): Promise<GeocodeResult | null> {
  if (!isGeocodingConfigured) {
    if (process.env.NODE_ENV !== 'production') console.log(`[geocode] (dry-run) ${address}`);
    return null;
  }

  try {
    const url = new URL('https://maps.googleapis.com/maps/api/geocode/json');
    url.searchParams.set('address', address);
    url.searchParams.set('region', region);
    url.searchParams.set('key', process.env.GOOGLE_MAPS_API_KEY!);

    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return null;
    const data = await res.json();
    const first = data?.results?.[0];
    if (!first?.geometry?.location) return null;

    return {
      location: { lat: first.geometry.location.lat, lng: first.geometry.location.lng },
      formatted: first.formatted_address ?? address,
      precision: first.geometry.location_type ?? 'APPROXIMATE',
    };
  } catch (err) {
    console.error('[geocode] failed', err);
    return null;
  }
}
