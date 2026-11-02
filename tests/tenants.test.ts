import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTenant, validateSlug } from '../lib/tenants/store';
import { notifyTenantOfLead, renderLeadEmail, type LeadNotification } from '../lib/tenants/notify';
import { DEFAULT_CALIBRATION, DEFAULT_PRICING, PLAN_QUOTA, type Tenant } from '../lib/tenants/types';

/**
 * Self-serve signup and the alert that follows a lead.
 *
 * These run against the in-memory store (no DATABASE_URL under the test
 * runner), which is the same code path a preview deploy uses.
 */

const lead: LeadNotification = {
  name: 'Ana Pérez',
  email: 'ana@example.com',
  phone: '718 555 0100',
  address: '123 Smith St',
  serviceSlug: 'house-cleaning',
  quoteLow: 150,
  quoteHigh: 180,
  currency: 'USD',
  minutes: 135,
};

function fakeTenant(over: Partial<Tenant> = {}): Tenant {
  return {
    id: 'ten_test',
    slug: 'limpieza-ana',
    name: 'Limpieza Ana',
    contactEmail: 'owner@example.com',
    plan: 'trial',
    active: true,
    monthlyQuota: 25,
    keyLast4: 'abcd',
    pricing: DEFAULT_PRICING,
    calibration: DEFAULT_CALIBRATION,
    branding: { displayName: 'Limpieza Ana' },
    createdAt: new Date().toISOString(),
    ...over,
  };
}

test('a reserved slug cannot be taken', () => {
  // /q/admin and /q/login are the shape of a link used to phish a tenant's
  // own customers, so the words are refused rather than policed later.
  for (const word of ['admin', 'api', 'login', 'q', 'pros']) {
    assert.ok(validateSlug(word), `"${word}" should be refused`);
  }
});

test('a slug must be a link, not a sentence', () => {
  assert.ok(validateSlug('ab'), 'two letters is not a name');
  assert.ok(validateSlug('Limpieza María'), 'spaces and accents must be refused');
  assert.ok(validateSlug('-limpieza'), 'a leading dash must be refused');
  assert.equal(validateSlug('limpieza-maria'), null);
  assert.equal(validateSlug('maria2'), null);
});

test('a chosen slug is taken literally or refused, never rewritten', async () => {
  const first = await createTenant({
    name: 'Brooklyn Shine',
    slug: 'brooklyn-shine',
    contactEmail: 'one@example.com',
  });
  assert.ok('tenant' in first);
  assert.equal(first.tenant.slug, 'brooklyn-shine');

  // The second company is about to paste this into an Instagram bio. Handing
  // them "brooklyn-shine-4f2a" without saying so would send their customers
  // to a competitor, so a clash has to be an error they can see.
  const second = await createTenant({
    name: 'Otra Empresa',
    slug: 'brooklyn-shine',
    contactEmail: 'two@example.com',
  });
  assert.ok('error' in second, 'a taken slug must be refused');
});

test('the admin path still derives and de-duplicates a slug', async () => {
  // No slug given means nobody is holding a link to paste, so a suffix is
  // fine — and an admin sees the result on screen either way.
  const a = await createTenant({ name: 'Shared Name Co', contactEmail: 'a@example.com' });
  const b = await createTenant({ name: 'Shared Name Co', contactEmail: 'b@example.com' });
  assert.ok('tenant' in a && 'tenant' in b);
  assert.notEqual(a.tenant.slug, b.tenant.slug);
});

test('an unvetted account gets a smaller allowance than a sold trial', async () => {
  // Every quote is a vision model call billed to us. A trial we sold to a
  // named company is worth that spend; an address nobody checked is not, yet.
  const created = await createTenant({
    name: 'Self Serve Co',
    slug: 'self-serve-co',
    contactEmail: 'self@example.com',
    quota: 25,
  });
  assert.ok('tenant' in created);
  assert.equal(created.tenant.monthlyQuota, 25);
  assert.ok(25 < PLAN_QUOTA.trial, 'self-serve must stay below the hand-sold trial');
});

test('a phone number is kept so the alert can reach a pocket', async () => {
  const created = await createTenant({
    name: 'Phone Co',
    slug: 'phone-co',
    contactEmail: 'p@example.com',
    contactPhone: '+17185550100',
  });
  assert.ok('tenant' in created);
  assert.equal(created.tenant.contactPhone, '+17185550100');
});

test('the alert escapes whatever the customer typed', () => {
  // The name field is filled in by a stranger on somebody else's website and
  // the result is rendered as HTML in a business owner's inbox.
  const html = renderLeadEmail(fakeTenant(), {
    ...lead,
    name: '<img src=x onerror="alert(1)">',
    notes: 'Dejar llave en el "buzón" & tocar <timbre>',
  });

  assert.ok(!html.includes('<img src=x'), 'raw markup reached the email body');
  assert.ok(!html.includes('onerror="'), 'an event handler reached the email body');
  assert.ok(html.includes('&lt;img src=x'), 'the text should still be readable, escaped');
  assert.ok(html.includes('&amp;'), 'an ampersand should be escaped, not dropped');
});

test('the alert carries what you need to call the customer back', () => {
  const html = renderLeadEmail(fakeTenant(), lead);
  assert.ok(html.includes('Ana Pérez'));
  assert.ok(html.includes('718 555 0100'));
  assert.ok(html.includes('123 Smith St'));
  assert.ok(html.includes('$150'), 'the price the customer saw must be in the alert');
  assert.ok(html.includes('2h 15m'), 'minutes should read as time, not as a number');
});

test('the alert is branded as the software, not as the cleaning company', () => {
  // Whoever signs up may compete with the cleaning business three streets
  // away. An email footed with that brand tells them their supplier is their
  // competitor, and the sensible reaction is to close the account.
  const html = renderLeadEmail(fakeTenant(), lead);
  assert.ok(!/Klaudy/i.test(html), 'the cleaning brand must not appear in a tenant alert');
});

test('signup refuses to run without a database', async () => {
  // Found by running it rather than by reading it: two companies signed up for
  // the same slug against the in-memory store and the second one took over the
  // first one's link, so /q/limpieza-maria started answering as "Otra". A slug
  // is unique because Postgres holds a unique index on it; with no database
  // there is no such promise, and handing someone a link they do not own is
  // worse than handing them nothing.
  const { POST } = await import('../app/api/tenants/signup/route');
  const res = await POST(
    new Request('http://localhost/api/tenants/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Sin Base De Datos',
        slug: 'sin-base-de-datos',
        email: 'x@example.com',
        hourlyRate: 50,
        minimumJob: 100,
      }),
    }),
  );

  assert.equal(res.status, 503, 'signup must refuse when nothing can hold the slug');
  const body = (await res.json()) as { error: string };
  assert.equal(body.error, 'no_database');
});

test('a dead email provider never costs a captured lead', async () => {
  // The lead row is already written by the time this runs. Throwing here
  // would turn a saved customer into an error telling them to try again.
  const out = await notifyTenantOfLead(fakeTenant({ contactPhone: '+17185550100' }), lead);
  assert.deepEqual(out, { email: false, sms: false });
});
