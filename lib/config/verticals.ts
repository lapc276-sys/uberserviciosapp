/**
 * Verticals = the business lines Homigo can operate.
 * Cleaning is live today. The rest are pre-modeled so launching a new
 * vertical is a data change (flip `status` to 'live') — never a rewrite.
 *
 * This is the mechanism that satisfies "escalar sin rehacer el sistema".
 */
export type VerticalStatus = 'live' | 'soon';

export interface Vertical {
  slug: string;
  name: string;
  icon: string; // lucide-react icon name
  tagline: string;
  status: VerticalStatus;
  accent: string; // tailwind color token for future theming
}

export const verticals: Vertical[] = [
  { slug: 'cleaning', name: 'Cleaning', icon: 'Sparkles', tagline: 'Spotless homes, on schedule.', status: 'live', accent: 'brand' },
  { slug: 'painting', name: 'Painting', icon: 'PaintRoller', tagline: 'Flawless walls, zero mess.', status: 'soon', accent: 'amber' },
  { slug: 'moving', name: 'Moving', icon: 'Truck', tagline: 'Stress-free moves.', status: 'soon', accent: 'emerald' },
  { slug: 'handyman', name: 'Handyman', icon: 'Hammer', tagline: 'Any fix, done right.', status: 'soon', accent: 'orange' },
  { slug: 'landscaping', name: 'Landscaping', icon: 'Trees', tagline: 'Yards that turn heads.', status: 'soon', accent: 'green' },
  { slug: 'pressure-washing', name: 'Pressure Washing', icon: 'Droplets', tagline: 'Like-new surfaces.', status: 'soon', accent: 'sky' },
  { slug: 'junk-removal', name: 'Junk Removal', icon: 'Trash2', tagline: 'Gone in a day.', status: 'soon', accent: 'rose' },
];

export const liveVerticals = verticals.filter((v) => v.status === 'live');
export const getVertical = (slug: string) => verticals.find((v) => v.slug === slug);
