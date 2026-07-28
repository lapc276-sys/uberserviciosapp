import { site } from './config/site';

/**
 * Transactional email via Resend. Env-gated: no-ops (dry-run) without
 * RESEND_API_KEY so the app runs everywhere. Set RESEND_API_KEY and
 * RESEND_FROM (e.g. "Homigo <hello@homigo.com>") to activate.
 */
export const isEmailConfigured = Boolean(process.env.RESEND_API_KEY);

interface EmailInput {
  to: string;
  subject: string;
  html: string;
  replyTo?: string;
  /**
   * Marks promotional mail. Marketing sends honor the opt-out list (CAN-SPAM);
   * transactional mail (confirmations, reminders) is always delivered.
   */
  marketing?: boolean;
}

/**
 * `suppressed` = recipient opted out of marketing (never send).
 * `skipped`    = no provider configured (dry-run).
 */
export type EmailOutcome = 'sent' | 'suppressed' | 'skipped' | 'failed';

export async function sendEmail({ to, subject, html, replyTo, marketing }: EmailInput): Promise<EmailOutcome> {
  if (marketing) {
    const { isUnsubscribed } = await import('./data');
    if (await isUnsubscribed(to)) {
      if (process.env.NODE_ENV !== 'production') console.log(`[email] suppressed (opted out) → ${to}`);
      return 'suppressed';
    }
  }

  if (!isEmailConfigured) {
    if (process.env.NODE_ENV !== 'production') console.log(`[email] (dry-run) → ${to}: ${subject}`);
    return 'skipped';
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: process.env.RESEND_FROM ?? `${site.name} <onboarding@resend.dev>`,
        to: [to],
        subject,
        html,
        reply_to: replyTo ?? site.email,
      }),
    });
    if (!res.ok) {
      console.error('[email] send failed', res.status, await res.text().catch(() => ''));
      return 'failed';
    }
    return 'sent';
  } catch (err) {
    console.error('[email] send error', err);
    return 'failed';
  }
}

// ── Templates ────────────────────────────────────────────────────────────────
/**
 * @param unsubscribeFor  Recipient address. Present only on promotional mail,
 *   which CAN-SPAM requires to carry a physical postal address and a working
 *   opt-out link. Transactional mail omits both.
 */
function shell(inner: string, unsubscribeFor?: string): string {
  const { street, city, region, postalCode } = site.address;
  const footer = unsubscribeFor
    ? `<p style="text-align:center;color:#9ca3af;font-size:12px;margin-top:20px;line-height:1.6">
         ${site.legalName}<br>${street}, ${city}, ${region} ${postalCode}<br>
         <a href="${site.url}/unsubscribe?e=${encodeURIComponent(unsubscribeFor)}" style="color:#9ca3af">Unsubscribe</a>
         · <a href="${site.url}" style="color:#9ca3af">${site.url.replace('https://', '')}</a>
       </p>`
    : `<p style="text-align:center;color:#9ca3af;font-size:12px;margin-top:20px">
         ${site.legalName} · <a href="${site.url}" style="color:#9ca3af">${site.url.replace('https://', '')}</a> · ${site.phone}
       </p>`;

  return `<div style="font-family:ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;max-width:520px;margin:0 auto;color:#0a0a0b">
    <div style="padding:24px 0;text-align:center">
      <span style="display:inline-block;background:#1b6ff5;color:#fff;width:36px;height:36px;line-height:36px;border-radius:9px;font-weight:700">H</span>
      <span style="font-weight:600;font-size:18px;margin-left:8px;vertical-align:middle">${site.name}</span>
    </div>
    <div style="border:1px solid #e5e7eb;border-radius:18px;padding:28px">${inner}</div>
    ${footer}
  </div>`;
}

export function bookingConfirmationEmail(p: {
  name: string;
  ref: string;
  serviceName: string;
  date: string;
  time: string;
  quoteLow?: number | null;
  quoteHigh?: number | null;
}): { subject: string; html: string } {
  const price =
    p.quoteLow && p.quoteHigh ? `$${p.quoteLow}–$${p.quoteHigh}` : 'Confirmed at booking';
  return {
    subject: `Your ${site.name} booking is confirmed (${p.ref})`,
    html: shell(`
      <h1 style="font-size:20px;margin:0 0 8px">You're booked, ${p.name.split(' ')[0]}! 🎉</h1>
      <p style="color:#4b5563;margin:0 0 20px">Everything's set. We'll send reminders before your appointment — no action needed.</p>
      <table style="width:100%;border-collapse:collapse;font-size:14px">
        ${row('Confirmation', p.ref)}
        ${row('Service', p.serviceName)}
        ${row('Date', p.date)}
        ${row('Time', p.time)}
        ${row('Estimate', price)}
      </table>
      <a href="${site.url}/book" style="display:inline-block;margin-top:24px;background:#1b6ff5;color:#fff;text-decoration:none;padding:12px 22px;border-radius:999px;font-weight:600;font-size:14px">Manage booking</a>
      <p style="color:#9ca3af;font-size:12px;margin-top:16px">You're only charged after the service. Free cancellation up to 24h before.</p>
    `),
  };
}

export function reminderEmail(p: { name: string; serviceName: string; date: string; time: string; when: '24h' | '2h' }): {
  subject: string;
  html: string;
} {
  const lead = p.when === '24h' ? 'is tomorrow' : 'is in about 2 hours';
  return {
    subject: `Reminder: your ${site.name} cleaning ${lead}`,
    html: shell(`
      <h1 style="font-size:20px;margin:0 0 8px">See you soon, ${p.name.split(' ')[0]}! 🧼</h1>
      <p style="color:#4b5563;margin:0 0 20px">Your ${p.serviceName} ${lead}.</p>
      <table style="width:100%;border-collapse:collapse;font-size:14px">
        ${row('Date', p.date)}
        ${row('Time', p.time)}
      </table>
      <p style="color:#4b5563;margin-top:20px">Please make sure our pro can access the space. Questions? Reply to this email or call ${site.phone}.</p>
    `),
  };
}

export function reviewRequestEmail(p: { name: string; serviceName: string }): { subject: string; html: string } {
  return {
    subject: `How did we do, ${p.name.split(' ')[0]}?`,
    html: shell(`
      <h1 style="font-size:20px;margin:0 0 8px">Thanks for choosing ${site.name}! ⭐</h1>
      <p style="color:#4b5563;margin:0 0 20px">We hope your ${p.serviceName} was spotless. A quick review helps us — and earns you <strong>10% off</strong> your next booking.</p>
      <a href="${site.social.google}" style="display:inline-block;background:#1b6ff5;color:#fff;text-decoration:none;padding:12px 22px;border-radius:999px;font-weight:600;font-size:14px">Leave a review</a>
      <p style="color:#9ca3af;font-size:12px;margin-top:16px">Book again anytime at ${site.url}/book</p>
    `),
  };
}

/**
 * Wraps promotional content in the branded shell **with** the CAN-SPAM footer
 * (postal address + working unsubscribe). Any marketing send must go through
 * this — raw HTML bodies would ship without the required footer.
 */
export function marketingShell(inner: string, recipientEmail: string): string {
  return shell(inner, recipientEmail);
}

export function winbackEmail(p: { name: string; email: string }): { subject: string; html: string } {
  return {
    subject: `We miss you, ${p.name.split(' ')[0]} — here's 15% off`,
    html: shell(
      `
      <h1 style="font-size:20px;margin:0 0 8px">Ready for another spotless day? ✨</h1>
      <p style="color:#4b5563;margin:0 0 20px">It's been a little while. Come back and take <strong>15% off</strong> your next cleaning — our thanks for being a ${site.name} customer.</p>
      <a href="${site.url}/book" style="display:inline-block;background:#1b6ff5;color:#fff;text-decoration:none;padding:12px 22px;border-radius:999px;font-weight:600;font-size:14px">Book &amp; save 15%</a>
      <p style="color:#9ca3af;font-size:12px;margin-top:16px">Offer applied automatically at checkout for a limited time.</p>
    `,
      p.email,
    ),
  };
}

function row(label: string, value: string): string {
  return `<tr>
    <td style="padding:8px 0;color:#6b7280;border-bottom:1px dashed #e5e7eb">${label}</td>
    <td style="padding:8px 0;text-align:right;font-weight:600;border-bottom:1px dashed #e5e7eb">${value}</td>
  </tr>`;
}
