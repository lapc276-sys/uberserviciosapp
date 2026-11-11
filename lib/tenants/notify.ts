import { sendEmail } from '../email';
import { sendSms } from '../sms';
import { engine } from '../config/engine';
import { services } from '../config/services';
import type { Tenant } from './types';

/**
 * Telling a cleaning company that someone just asked them for a price.
 *
 * This is the step that turns the product from a calculator into a reason to
 * pay. A lead that sits in a database until the owner happens to log in is a
 * lead that went to whoever answered first — and in this trade that is usually
 * measured in minutes, not days. They are on a job with their phone in a
 * pocket, so the message has to reach the phone.
 *
 * Nothing here may throw. The lead is already saved by the time this runs, and
 * a dead email provider must never turn a captured customer into a 500 that
 * tells the customer to try again.
 */

export interface LeadNotification {
  name: string;
  email?: string;
  phone?: string;
  address?: string;
  notes?: string;
  serviceSlug: string;
  quoteLow: number;
  quoteHigh: number;
  currency: string;
  minutes: number;
  condition?: string;
}

function serviceName(slug: string): string {
  return services.find((s) => s.slug === slug)?.name ?? slug;
}

function money(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    // An invalid currency code from tenant settings must not break the alert.
    return `${amount} ${currency}`;
  }
}

function duration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h ? `${h}h ${m}m` : `${m}m`;
}

function row(label: string, value: string): string {
  return `<tr>
    <td style="padding:6px 12px 6px 0;color:#6b7280;font-size:13px;vertical-align:top;white-space:nowrap">${label}</td>
    <td style="padding:6px 0;font-size:14px;color:#111827">${value}</td>
  </tr>`;
}

/** Minimal escaping — every value below is customer-supplied free text. */
function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Exported so the escaping can be tested directly.
 *
 * Every value in here is typed by a stranger on someone else's website and
 * lands in a cleaning company's inbox. Without a test the escaping is one
 * careless template edit away from being gone, and nothing would look wrong.
 */
export function renderLeadEmail(tenant: Tenant, lead: LeadNotification): string {
  const price =
    lead.quoteLow === lead.quoteHigh
      ? money(lead.quoteLow, lead.currency)
      : `${money(lead.quoteLow, lead.currency)} – ${money(lead.quoteHigh, lead.currency)}`;

  // Tap-to-call and tap-to-email, because this is read on a phone between jobs.
  const phoneCell = lead.phone
    ? `<a href="tel:${esc(lead.phone.replace(/[^\d+]/g, ''))}" style="color:#1b6ff5;text-decoration:none">${esc(lead.phone)}</a>`
    : '—';
  const emailCell = lead.email
    ? `<a href="mailto:${esc(lead.email)}" style="color:#1b6ff5;text-decoration:none">${esc(lead.email)}</a>`
    : '—';

  return `<div style="font-family:ui-sans-serif,system-ui,sans-serif;max-width:520px;margin:0 auto;padding:24px">
    <p style="margin:0;color:#6b7280;font-size:13px">${esc(tenant.branding.displayName)}</p>
    <h1 style="margin:4px 0 2px;font-size:20px;color:#111827">Nuevo presupuesto pedido</h1>
    <p style="margin:0 0 18px;color:#6b7280;font-size:14px">
      ${esc(lead.name)} acaba de grabar su casa y vio este precio. Llámalo pronto.
    </p>

    <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;padding:16px;margin-bottom:18px">
      <p style="margin:0;color:#166534;font-size:13px">Precio que vio el cliente</p>
      <p style="margin:2px 0 0;font-size:28px;font-weight:600;color:#14532d">${price}</p>
    </div>

    <table style="border-collapse:collapse;width:100%">
      ${row('Cliente', esc(lead.name))}
      ${row('Teléfono', phoneCell)}
      ${row('Correo', emailCell)}
      ${row('Dirección', lead.address ? esc(lead.address) : '—')}
      ${row('Servicio', esc(serviceName(lead.serviceSlug)))}
      ${row('Tiempo estimado', duration(lead.minutes))}
      ${lead.condition ? row('Estado del sitio', esc(lead.condition)) : ''}
      ${lead.notes ? row('Lo que pidió', esc(lead.notes)) : ''}
    </table>

    <p style="margin:22px 0 0;color:#9ca3af;font-size:12px">
      Enviado por ${esc(engine.name)} porque alguien usó tu link
      ${esc(engine.url)}/q/${esc(tenant.slug)}
    </p>
  </div>`;
}

function buildSms(tenant: Tenant, lead: LeadNotification): string {
  const price =
    lead.quoteLow === lead.quoteHigh
      ? money(lead.quoteLow, lead.currency)
      : `${money(lead.quoteLow, lead.currency)}-${money(lead.quoteHigh, lead.currency)}`;

  // Deliberately short. A long SMS splits into several billed segments and
  // arrives out of order on some carriers, which is worse than terse.
  return [
    `${tenant.branding.displayName}: nuevo presupuesto.`,
    `${lead.name} — ${price} (${serviceName(lead.serviceSlug)}).`,
    lead.phone ? `Tel ${lead.phone}.` : '',
    'Detalles en tu correo.',
  ]
    .filter(Boolean)
    .join(' ');
}

/**
 * Sends the alert, swallowing every failure.
 *
 * Returns which channels actually went out, so a caller that wants to log it
 * can, without any caller being able to fail because of it.
 */
export async function notifyTenantOfLead(
  tenant: Tenant,
  lead: LeadNotification,
): Promise<{ email: boolean; sms: boolean }> {
  const out = { email: false, sms: false };

  try {
    const outcome = await sendEmail({
      to: tenant.contactEmail,
      subject: `Nuevo presupuesto: ${lead.name} — ${money(lead.quoteHigh, lead.currency)}`,
      html: renderLeadEmail(tenant, lead),
      // Replying to the alert reaches the customer directly, so the fastest
      // possible response is the owner's existing habit: hit reply.
      replyTo: lead.email || undefined,
    });
    out.email = outcome === 'sent';
  } catch (err) {
    console.error('[tenant-notify] email failed', err);
  }

  if (tenant.contactPhone) {
    try {
      out.sms = await sendSms(tenant.contactPhone, buildSms(tenant, lead));
    } catch (err) {
      console.error('[tenant-notify] sms failed', err);
    }
  }

  return out;
}
