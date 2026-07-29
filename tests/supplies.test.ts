import { describe, it, expect } from 'vitest';
import { planSupplies, SUPPLY_CATALOG } from '@/lib/vision/supplies';
import { EMPTY_SOIL, type SoilScores } from '@/lib/vision/types';

/**
 * Supply planning — and the safety rules inside it.
 *
 * The chemical-incompatibility assertions are the only tests in this suite
 * where a regression could put someone in an emergency room rather than just
 * cost money. Bleach with ammonia releases chloramine gas, and a plan that
 * quietly recommends both without a warning is exactly how that happens on a
 * real job: mold remover in the shower, glass cleaner on the door.
 */

const plan = (soil: Partial<SoilScores>, opts: Partial<Parameters<typeof planSupplies>[0]> = {}) =>
  planSupplies({
    soil: { ...EMPTY_SOIL, ...soil },
    objects: [],
    roomTypes: ['kitchen', 'bathroom'],
    serviceSlug: 'house-cleaning',
    totalMinutes: 180,
    ...opts,
  });

describe('planSupplies', () => {
  it('always brings the basics', () => {
    const result = plan({});
    expect(result.lines.length).toBeGreaterThan(0);
    expect(result.totalCost).toBeGreaterThanOrEqual(0);
  });

  it('adds a degreaser when there is grease', () => {
    const withGrease = plan({ grease: 80 }).lines.map((l) => l.id);
    expect(withGrease).toContain('degreaser');
  });

  it('adds mold remover when there is mold', () => {
    expect(plan({ mold: 70 }).lines.map((l) => l.id)).toContain('mold_remover');
  });

  it('scales quantities with job length rather than sending one bottle to every job', () => {
    const short = plan({ grease: 80 }, { totalMinutes: 60 });
    const long = plan({ grease: 80 }, { totalMinutes: 600 });
    expect(long.totalCost).toBeGreaterThan(short.totalCost);
  });

  it('keeps per-job consumable cost realistic, not retail-bottle-per-job', () => {
    // A working business buys concentrate by the gallon. If this figure drifts
    // into the tens of dollars, the margin number downstream becomes fiction.
    const consumables = plan({ grease: 60, mold: 50, dust: 70 }).lines
      .filter((l) => l.category !== 'tool')
      .reduce((sum, l) => sum + l.estimatedCost, 0);
    expect(consumables).toBeLessThan(30);
  });

  it('lists required PPE for hazardous products', () => {
    const result = plan({ mold: 80 });
    expect(result.ppeRequired.length).toBeGreaterThan(0);
  });

  describe('chemical safety', () => {
    it('warns when the plan pairs a bleach product with an ammonia one', () => {
      // Mold remover is bleach-based; glass cleaner is ammonia-based.
      const result = plan({ mold: 80, dust: 70 }, { objects: [{ name: 'window', count: 4, confidence: 1 }] });
      const ids = result.lines.map((l) => l.id);

      if (ids.includes('mold_remover') && ids.includes('glass_cleaner')) {
        expect(result.safetyWarnings.length).toBeGreaterThan(0);
        expect(result.safetyWarnings.join(' ')).toMatch(/chloramine|never mix/i);
      }
    });

    it('warns when the plan pairs bleach with an acid', () => {
      const result = plan({ mold: 80 }, { roomTypes: ['bathroom'], objects: [{ name: 'toilet', count: 2, confidence: 1 }] });
      const ids = result.lines.map((l) => l.id);

      if (ids.includes('mold_remover') && ids.some((id) => SUPPLY_CATALOG[id]?.hazard === 'acid')) {
        expect(result.safetyWarnings.length).toBeGreaterThan(0);
      }
    });

    it('stays quiet when nothing incompatible was selected', () => {
      expect(plan({ dust: 30 }).safetyWarnings).toHaveLength(0);
    });

    /**
     * A catalog entry that declares a hazard but no protective equipment is a
     * silent gap — the warning exists but nobody is told what to wear.
     */
    it('gives every caustic or bleach product its PPE in the catalog', () => {
      for (const supply of Object.values(SUPPLY_CATALOG)) {
        if (supply.hazard === 'caustic' || supply.hazard === 'bleach') {
          expect(supply.requiresPpe, `${supply.id} declares a hazard but no PPE`).toBeTruthy();
          expect(supply.requiresPpe!.length).toBeGreaterThan(0);
        }
      }
    });
  });

  describe('catalog integrity', () => {
    it('names generic product types, never brands', () => {
      // A platform sold internationally cannot endorse a bottle. This is a
      // spot check on the discipline, not a trademark database.
      const brands = /clorox|lysol|windex|fabuloso|mr\.? clean|ajax|pine-?sol/i;
      for (const supply of Object.values(SUPPLY_CATALOG)) {
        expect(supply.name, `${supply.id} looks like a brand name`).not.toMatch(brands);
      }
    });

    it('gives consumables a coverage figure so quantities can scale', () => {
      for (const supply of Object.values(SUPPLY_CATALOG)) {
        if (supply.category === 'chemical' || supply.category === 'consumable') {
          expect(supply.coversMinutes, `${supply.id} has no coverage`).toBeGreaterThan(0);
        }
      }
    });

    it('keys every entry to its own id', () => {
      for (const [key, supply] of Object.entries(SUPPLY_CATALOG)) {
        expect(supply.id).toBe(key);
      }
    });
  });
});
