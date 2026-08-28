import { listCustomers, isUnsubscribed, type CustomerSummary } from '../data';
import { sendEmail, marketingShell, canSendMarketing } from '../email';
import { site } from '../config/site';

/**
 * Lifecycle email campaigns.
 *
 * Segments are derived from booking history, so no one maintains lists by
 * hand. Every send is marketing-class: it honors the opt-out list and carries
 * a postal address plus unsubscribe link (CAN-SPAM).
 *
 * Reactivating a lapsed customer is the cheapest revenue in this business —
 * they already trust you, so there's no CAC to pay a second time.
 */

export type Segment = 'lapsed' | 'one_time' | 'loyal' | 'high_value';

export interface SegmentedCustomer extends CustomerSummary {
  segment: Segment;
  daysSinceLast: number;
}

const DAY = 1000 * 60 * 60 * 24;

/** Days of silence before we consider a customer lapsed. */
const LAPSED_AFTER_DAYS = 45;
/** Spend that marks a customer as worth extra care. */
const HIGH_VALUE_LTV = 600;

export function segmentCustomers(customers: CustomerSummary[], now = Date.now()): SegmentedCustomer[] {
  return customers.map((c) => {
    const daysSinceLast = c.lastBooking ? Math.floor((now - new Date(c.lastBooking).getTime()) / DAY) : 9999;

    let segment: Segment;
    if (daysSinceLast >= LAPSED_AFTER_DAYS) segment = 'lapsed';
    else if (c.ltv >= HIGH_VALUE_LTV) segment = 'high_value';
    else if (c.bookings >= 3) segment = 'loyal';
    else segment = 'one_time';

    return { ...c, segment, daysSinceLast };
  });
}

interface CampaignTemplate {
  segment: Segment;
  subject: (c: SegmentedCustomer) => string;
  body: (c: SegmentedCustomer) => string;
  promoCode?: string;
  /** Don't email the same person about the same thing more often than this. */
  cooldownDays: number;
}

function cta(label: string, promo?: string): string {
  const url = promo ? `${site.url}/book?promo=${promo}` : `${site.url}/book`;
  return `<a href="${url}" style="display:inline-block;margin-top:16px;background:#1b6ff5;color:#fff;text-decoration:none;padding:12px 22px;border-radius:999px;font-weight:600;font-size:14px">${label}</a>`;
}

export const CAMPAIGNS: CampaignTemplate[] = [
  {
    segment: 'lapsed',
    promoCode: 'COMEBACK15',
    cooldownDays: 60,
    subject: (c) => `${c.name.split(' ')[0]}, your place is due for a refresh`,
    body: (c) => `
      <h1 style="font-size:20px;margin:0 0 8px">It's been a while ✨</h1>
      <p style="color:#4b5563">Your last cleaning with us was ${c.daysSinceLast} days ago. Book again with code
        <strong>COMEBACK15</strong> and take <strong>15% off</strong>.</p>
      ${cta('Book & save 15%', 'COMEBACK15')}`,
  },
  {
    segment: 'one_time',
    cooldownDays: 30,
    subject: () => 'Never think about cleaning again',
    body: (c) => `
      <h1 style="font-size:20px;margin:0 0 8px">Hi ${c.name.split(' ')[0]} 👋</h1>
      <p style="color:#4b5563">Customers who switch to a recurring plan save up to <strong>20%</strong> — and stop
        having to remember to book. Weekly, bi-weekly or monthly, cancel anytime.</p>
      ${cta('See recurring plans')}`,
  },
  {
    segment: 'loyal',
    cooldownDays: 45,
    subject: (c) => `Thanks for ${c.bookings} cleanings, ${c.name.split(' ')[0]}`,
    body: (c) => `
      <h1 style="font-size:20px;margin:0 0 8px">You're one of our regulars 💙</h1>
      <p style="color:#4b5563">Thanks for trusting ${site.name} ${c.bookings} times. Know someone who could use a
        spotless home? Share ${site.name} and you'll both get a treat on your next clean.</p>
      ${cta('Book your next clean')}`,
  },
  {
    segment: 'high_value',
    cooldownDays: 45,
    subject: (c) => `${c.name.split(' ')[0]}, a note from ${site.name}`,
    body: (c) => `
      <h1 style="font-size:20px;margin:0 0 8px">Thank you for your business 🙏</h1>
      <p style="color:#4b5563">You're one of our most valued customers. If there's ever anything you'd like handled
        differently, reply to this email — it comes straight to us.</p>
      ${cta('Book your next clean')}`,
  },
];

export interface CampaignRun {
  sent: number;
  suppressed: number;
  /** Set when the run stopped for a legal or config reason, not a per-recipient one. */
  blocked?: 'no_postal_address';
  skipped: number;
  bySegment: Record<string, number>;
}

/**
 * Sends one campaign email per eligible customer.
 * `dryRun` reports who would be contacted without sending anything.
 */
export async function runCampaigns(options: { dryRun?: boolean; now?: number } = {}): Promise<CampaignRun> {
  const now = options.now ?? Date.now();
  const customers = segmentCustomers(await listCustomers(), now);
  const result: CampaignRun = { sent: 0, suppressed: 0, skipped: 0, bySegment: {} };

  for (const customer of customers) {
    if (!customer.email) {
      result.skipped++;
      continue;
    }

    const template = CAMPAIGNS.find((c) => c.segment === customer.segment);
    if (!template) {
      result.skipped++;
      continue;
    }

    // Respect the cooldown so a lapsed customer isn't emailed every run.
    if (customer.daysSinceLast < template.cooldownDays && customer.segment !== 'lapsed') {
      result.skipped++;
      continue;
    }

    if (await isUnsubscribed(customer.email)) {
      result.suppressed++;
      continue;
    }

    // A commercial message with no postal address violates CAN-SPAM on every
    // send, so this blocks rather than degrades. A dry run still reports what
    // *would* go out, which is how you notice the address is missing.
    if (!options.dryRun && !canSendMarketing()) {
      result.blocked = 'no_postal_address';
      break;
    }

    if (options.dryRun) {
      result.sent++;
      result.bySegment[customer.segment] = (result.bySegment[customer.segment] ?? 0) + 1;
      continue;
    }

    const outcome = await sendEmail({
      to: customer.email,
      subject: template.subject(customer),
      html: marketingShell(template.body(customer), customer.email),
      marketing: true,
    });

    if (outcome === 'suppressed') result.suppressed++;
    else {
      result.sent++;
      result.bySegment[customer.segment] = (result.bySegment[customer.segment] ?? 0) + 1;
    }
  }

  return result;
}
