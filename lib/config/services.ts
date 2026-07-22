/**
 * Every cleaning service is a data record. Adding a service = adding an entry.
 * Each generates: a page at /services/[slug], schema.org markup, an entry in
 * the booking flow, a quote pricing rule, and chatbot knowledge.
 */
export interface Service {
  slug: string;
  vertical: string;
  name: string;
  shortName: string;
  icon: string; // lucide-react icon name
  summary: string;
  description: string;
  // Pricing model used by the instant quote engine (USD).
  pricing: {
    base: number; // flat starting price
    perBedroom: number;
    perBathroom: number;
    perSqftThousand: number; // added per 1,000 sqft
    estimatedHours: string;
  };
  includes: string[];
  popular?: boolean;
  faqs: { q: string; a: string }[];
  seo: { title: string; description: string; keywords: string[] };
}

export const services: Service[] = [
  {
    slug: 'deep-cleaning',
    vertical: 'cleaning',
    name: 'Deep Cleaning',
    shortName: 'Deep Clean',
    icon: 'Sparkles',
    summary: 'Top-to-bottom reset for your entire home.',
    description:
      'A meticulous, top-to-bottom clean that reaches the spots regular cleanings miss — baseboards, inside appliances, grout, vents, and every corner. Ideal for first-time cleans or seasonal resets.',
    pricing: { base: 149, perBedroom: 35, perBathroom: 30, perSqftThousand: 25, estimatedHours: '3–5 hrs' },
    includes: ['Baseboards & trim', 'Inside oven & fridge', 'Grout & tile scrub', 'Vents & fans', 'Interior windows', 'Cabinet fronts'],
    popular: true,
    faqs: [
      { q: 'How is deep cleaning different from standard cleaning?', a: 'Deep cleaning covers everything a standard clean does, plus detailed work like inside appliances, baseboards, grout and vents. We recommend it for your first Homigo visit.' },
      { q: 'How long does a deep clean take?', a: 'Typically 3–5 hours depending on home size and condition. Your instant quote estimates this for you.' },
    ],
    seo: {
      title: 'Deep Cleaning Service — Book Online in 60 Seconds | Homigo',
      description: 'Professional deep cleaning by insured, background-checked pros. Instant online quote, flexible scheduling, satisfaction guaranteed.',
      keywords: ['deep cleaning service', 'deep house cleaning', 'professional deep clean near me'],
    },
  },
  {
    slug: 'house-cleaning',
    vertical: 'cleaning',
    name: 'House Cleaning',
    shortName: 'House Clean',
    icon: 'Home',
    summary: 'Recurring or one-time cleaning that keeps home effortless.',
    description:
      'Reliable standard cleaning for kitchens, bathrooms, bedrooms and living spaces. Set it weekly, bi-weekly or monthly and never think about it again — Homigo remembers, reminds and shows up.',
    pricing: { base: 99, perBedroom: 25, perBathroom: 22, perSqftThousand: 18, estimatedHours: '2–3 hrs' },
    includes: ['Dusting all surfaces', 'Kitchen & counters', 'Bathrooms sanitized', 'Floors vacuumed & mopped', 'Trash removed', 'Beds made'],
    popular: true,
    faqs: [
      { q: 'Do I need to be home?', a: 'No. Most customers share entry instructions once and we handle the rest. You get before/after photos in your dashboard.' },
      { q: 'Can I get the same cleaner each time?', a: 'Yes — recurring plans are matched to the same pro whenever possible.' },
    ],
    seo: {
      title: 'House Cleaning Service — Recurring & One-Time | Homigo',
      description: 'Trusted house cleaning with instant pricing and automated scheduling. Weekly, bi-weekly, monthly or one-time. Book online now.',
      keywords: ['house cleaning service', 'maid service near me', 'recurring house cleaning'],
    },
  },
  {
    slug: 'apartment-cleaning',
    vertical: 'cleaning',
    name: 'Apartment Cleaning',
    shortName: 'Apartment',
    icon: 'Building2',
    summary: 'Fast, affordable cleaning sized for apartments & condos.',
    description:
      'Cleaning tailored to apartments and condos — efficient, affordable and perfect for busy renters. Great for lease requirements, guests, or just staying on top of things.',
    pricing: { base: 89, perBedroom: 22, perBathroom: 20, perSqftThousand: 16, estimatedHours: '1.5–2.5 hrs' },
    includes: ['Kitchen & appliances', 'Bathroom sanitizing', 'Dusting & surfaces', 'Floors cleaned', 'Trash removed'],
    faqs: [
      { q: 'Do you clean studio apartments?', a: 'Absolutely. Our instant quote adjusts to any size, including studios.' },
    ],
    seo: {
      title: 'Apartment Cleaning Service — Book Online | Homigo',
      description: 'Affordable apartment & condo cleaning with instant online pricing. Insured pros, flexible times, satisfaction guaranteed.',
      keywords: ['apartment cleaning', 'condo cleaning service', 'apartment cleaners near me'],
    },
  },
  {
    slug: 'move-in-cleaning',
    vertical: 'cleaning',
    name: 'Move In Cleaning',
    shortName: 'Move In',
    icon: 'LogIn',
    summary: 'Start fresh in a truly clean new home.',
    description:
      'A thorough clean of your empty new place before you unpack — inside cabinets, appliances, closets and every surface — so day one feels brand new.',
    pricing: { base: 169, perBedroom: 38, perBathroom: 32, perSqftThousand: 28, estimatedHours: '3–5 hrs' },
    includes: ['Inside all cabinets', 'Inside appliances', 'Closets & shelves', 'Baseboards & doors', 'Windows & sills', 'Full floor care'],
    faqs: [
      { q: 'Should I book before or after moving furniture in?', a: 'Before — an empty home lets us clean every surface with nothing in the way.' },
    ],
    seo: {
      title: 'Move In Cleaning Service — Book Online | Homigo',
      description: 'Move-in cleaning that makes your new home spotless before you unpack. Instant quote, insured pros, book online in minutes.',
      keywords: ['move in cleaning', 'move in cleaning service near me', 'new home cleaning'],
    },
  },
  {
    slug: 'move-out-cleaning',
    vertical: 'cleaning',
    name: 'Move Out Cleaning',
    shortName: 'Move Out',
    icon: 'LogOut',
    summary: 'Get your full deposit back — guaranteed clean.',
    description:
      'A deep, checklist-driven clean designed to meet landlord and property-manager standards so you get your deposit back. Includes inside appliances, cabinets and detailed bathroom/kitchen work.',
    pricing: { base: 179, perBedroom: 40, perBathroom: 34, perSqftThousand: 30, estimatedHours: '3–6 hrs' },
    includes: ['Inside cabinets & drawers', 'Inside oven & fridge', 'Detailed bathrooms', 'Baseboards & walls spot-clean', 'Interior windows', 'Floors deep-cleaned'],
    popular: true,
    faqs: [
      { q: 'Do you follow a move-out checklist?', a: 'Yes. We use a landlord-standard checklist and send photo proof, which many property managers accept.' },
    ],
    seo: {
      title: 'Move Out Cleaning Service — Deposit-Back Clean | Homigo',
      description: 'Move-out cleaning built to landlord standards so you get your deposit back. Instant pricing, photo proof, book online.',
      keywords: ['move out cleaning', 'end of lease cleaning', 'move out cleaning service near me'],
    },
  },
  {
    slug: 'airbnb-cleaning',
    vertical: 'cleaning',
    name: 'Airbnb Cleaning',
    shortName: 'Airbnb',
    icon: 'BedDouble',
    summary: 'Turnovers that keep your 5-star rating.',
    description:
      'Fast, reliable turnover cleaning for short-term rentals — synced to your booking calendar, with restocking, staging and photo confirmation between every guest.',
    pricing: { base: 109, perBedroom: 26, perBathroom: 24, perSqftThousand: 18, estimatedHours: '1.5–3 hrs' },
    includes: ['Guest-ready staging', 'Linen change', 'Restock essentials', 'Full sanitize', 'Photo confirmation', 'Damage reporting'],
    faqs: [
      { q: 'Can you sync with my booking calendar?', a: 'Yes — connect your calendar and turnovers auto-schedule after each checkout.' },
    ],
    seo: {
      title: 'Airbnb & Short-Term Rental Cleaning | Homigo',
      description: 'Automated Airbnb turnover cleaning synced to your calendar. Restocking, staging, photo proof. Keep your 5-star rating.',
      keywords: ['airbnb cleaning service', 'short term rental cleaning', 'vacation rental turnover cleaning'],
    },
  },
  {
    slug: 'office-cleaning',
    vertical: 'cleaning',
    name: 'Office Cleaning',
    shortName: 'Office',
    icon: 'Briefcase',
    summary: 'A healthier, sharper workspace your team notices.',
    description:
      'Recurring commercial cleaning for offices and workspaces — desks, common areas, restrooms and floors — scheduled around your hours with reliable, vetted crews.',
    pricing: { base: 139, perBedroom: 0, perBathroom: 30, perSqftThousand: 22, estimatedHours: '2–4 hrs' },
    includes: ['Workstations & desks', 'Break rooms', 'Restroom sanitizing', 'Common areas', 'Trash & recycling', 'Floor care'],
    faqs: [
      { q: 'Can you clean after business hours?', a: 'Yes — evening and early-morning slots keep your team uninterrupted.' },
    ],
    seo: {
      title: 'Office & Commercial Cleaning Service | Homigo',
      description: 'Reliable recurring office cleaning scheduled around your hours. Vetted crews, transparent pricing, easy invoicing.',
      keywords: ['office cleaning service', 'commercial cleaning near me', 'janitorial service'],
    },
  },
  {
    slug: 'post-construction-cleaning',
    vertical: 'cleaning',
    name: 'Post Construction Cleaning',
    shortName: 'Post-Construction',
    icon: 'HardHat',
    summary: 'From dusty job site to move-in ready.',
    description:
      'Heavy-duty cleanup after renovation or construction — fine dust removal, debris, paint spots, sticker and residue removal, and a full detail so the space is ready to hand over.',
    pricing: { base: 249, perBedroom: 45, perBathroom: 40, perSqftThousand: 40, estimatedHours: '4–8 hrs' },
    includes: ['Fine dust removal', 'Debris cleanup', 'Paint & adhesive removal', 'Window & track detail', 'Fixture polishing', 'Full floor restoration'],
    faqs: [
      { q: 'Do you handle heavy construction dust?', a: 'Yes — we use HEPA vacuums and a multi-pass process to capture fine dust that settles for days.' },
    ],
    seo: {
      title: 'Post-Construction Cleaning Service | Homigo',
      description: 'Post-construction & post-renovation cleaning that turns a job site into a move-in-ready space. Instant quote, book online.',
      keywords: ['post construction cleaning', 'post renovation cleaning', 'construction cleanup service'],
    },
  },
  {
    slug: 'commercial-cleaning',
    vertical: 'cleaning',
    name: 'Commercial Cleaning',
    shortName: 'Commercial',
    icon: 'Store',
    summary: 'Scalable cleaning for retail, medical & more.',
    description:
      'Custom commercial cleaning programs for retail, medical, hospitality and multi-site businesses — with consistent standards, reporting and a single point of scheduling.',
    pricing: { base: 199, perBedroom: 0, perBathroom: 35, perSqftThousand: 24, estimatedHours: '3–6 hrs' },
    includes: ['Custom scope & SLA', 'Sanitizing protocols', 'Multi-site scheduling', 'Supply management', 'Digital reporting', 'Dedicated account'],
    faqs: [
      { q: 'Do you service multiple locations?', a: 'Yes — multi-site programs roll up to one dashboard and one invoice.' },
    ],
    seo: {
      title: 'Commercial Cleaning Service — Retail, Medical & More | Homigo',
      description: 'Scalable commercial cleaning programs with consistent standards and digital reporting. Request a tailored quote.',
      keywords: ['commercial cleaning service', 'retail cleaning', 'medical office cleaning'],
    },
  },
];

export const getService = (slug: string) => services.find((s) => s.slug === slug);
export const popularServices = services.filter((s) => s.popular);
export const servicesByVertical = (vertical: string) => services.filter((s) => s.vertical === vertical);
