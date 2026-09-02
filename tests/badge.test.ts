import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleFor, badgeUrl, badgeSvg, PRINT_NOTES } from '../lib/pros/badge';

/**
 * A handle ends up printed on fabric, so the properties that matter are the
 * ones that would force a reprint: uniqueness, and surviving names that a
 * naive slug would mangle into nothing.
 */

test('builds a handle from a name', () => {
  assert.equal(handleFor('Ana Pérez', new Set()), 'anaperez');
  // Accents and punctuation must fold rather than vanish, or "José" and
  // "Jose" produce two different people.
  assert.equal(handleFor('José María Ruiz-Díaz', new Set()), 'josemariaruiz');
});

test('never reuses a handle that is already printed on somebody', () => {
  const taken = new Set(['anaperez', 'anaperez2']);
  assert.equal(handleFor('Ana Pérez', taken), 'anaperez3');
});

test('always returns something usable', () => {
  // A name that slugs to nothing still needs a badge.
  const handle = handleFor('学', new Set());
  assert.ok(handle.length > 0);
  assert.match(handle, /^[a-z0-9]+$/);
});

test('the badge URL is the profile URL', () => {
  assert.match(badgeUrl('anaperez'), /\/p\/anaperez$/);
});

test('renders a scannable SVG, not a raster', async () => {
  const svg = await badgeSvg('anaperez');
  assert.match(svg, /^<svg/);
  // Printed at whatever size a printer decides, so it must stay vector.
  assert.ok(!svg.includes('<image'));
  assert.ok(svg.includes('anaperez') === false, 'the URL is encoded, not embedded as text');
});

test('the print guidance survives', () => {
  // These exist because the failure they prevent is silent: a hundred shirts
  // that look right and do not scan.
  assert.ok(PRINT_NOTES.length >= 4);
  assert.ok(PRINT_NOTES.some((n) => /tela elástica|parche/.test(n)));
});
