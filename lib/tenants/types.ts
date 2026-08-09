import type { RoomType } from '../vision/types';

/**
 * Multi-tenancy for the quoting engine sold as B2B software.
 *
 * The marketplace is one customer of this engine. A cleaning company in
 * Madrid or Manchester is another, and it does not share our hourly rate, our
 * currency, our sales tax, or — most importantly — our time model. Their crews
 * are faster or slower than ours, and the whole value of the product is that
 * the estimate converges on *their* reality after a few dozen jobs.
 *
 * Everything here is therefore per-tenant data, not code. Adding a customer
 * is a database row, never a deploy.
 */

/** How a tenant turns estimated labor minutes into a price. */
export interface TenantPricing {
  /** What the tenant charges the end customer per labor hour. */
  hourlyRate: number;
  /** Floor, so a tiny job still covers travel and setup. */
  minimumJob: number;
  /**
   * What the tenant pays their own cleaner per labor hour. Only used to show
   * them their margin — it never affects the customer-facing price.
   */
  laborCostRate: number;
  /** ISO 4217. The engine is sold worldwide; USD is just our default. */
  currency: string;
  /** 0–1. Applied on top of the pre-tax price. */
  taxRate: number;
  taxAppliesTo: 'all' | 'commercial' | 'none';
  taxNote?: string;
  /**
   * Scales our USD supply-cost table to the tenant's market. Consumables cost
   * roughly half in Mexico and roughly double in Norway, and a supply estimate
   * that is wrong by 3x makes the margin figure worthless.
   */
  supplyCostMultiplier: number;
}

/**
 * Per-tenant corrections to the time model.
 *
 * This is the product. The shipped constants in lib/vision/model.ts are a
 * hypothesis derived from our own jobs; a tenant's own predicted-vs-actual
 * history is the truth, and these fields are where that truth is written back.
 */
export interface TenantCalibration {
  /**
   * One dial for "our crews run faster/slower than the shipped baseline".
   * 0.85 means this tenant finishes in 85% of the default time. Derived from
   * their actuals, this alone removes most systematic bias.
   */
  globalTimeFactor: number;
  /** Overrides for specific room types they handle differently. */
  roomBaseMinutes: Partial<Record<RoomType, number>>;
  /** Overrides for what each service means to them. */
  serviceMultiplier: Record<string, number>;
  /** How many completed jobs these numbers were fit on. 0 = shipped defaults. */
  sampleSize: number;
  calibratedAt?: string;
}

export interface TenantBranding {
  displayName: string;
  /** Absolute https URL, rendered in the embedded widget. */
  logoUrl?: string;
  /** Hex, e.g. "#0F172A". */
  primaryColor?: string;
}

export type TenantPlan = 'trial' | 'starter' | 'growth' | 'scale';

export interface Tenant {
  id: string;
  /** URL-safe identifier, unique. */
  slug: string;
  name: string;
  contactEmail: string;
  plan: TenantPlan;
  active: boolean;
  /** Quotes allowed per calendar month. */
  monthlyQuota: number;
  /** Shown in the dashboard so a key can be identified without revealing it. */
  keyLast4: string;
  pricing: TenantPricing;
  calibration: TenantCalibration;
  branding: TenantBranding;
  createdAt: string;
}

/** Quota per plan. The trial is deliberately generous enough to prove value. */
export const PLAN_QUOTA: Record<TenantPlan, number> = {
  trial: 50,
  starter: 500,
  growth: 2_500,
  scale: 25_000,
};

export const DEFAULT_PRICING: TenantPricing = {
  hourlyRate: 55,
  minimumJob: 89,
  laborCostRate: 32,
  currency: 'USD',
  taxRate: 0,
  taxAppliesTo: 'none',
  supplyCostMultiplier: 1,
};

export const DEFAULT_CALIBRATION: TenantCalibration = {
  globalTimeFactor: 1,
  roomBaseMinutes: {},
  serviceMultiplier: {},
  sampleSize: 0,
};

export interface TenantUsage {
  tenantId: string;
  /** Calendar month, "YYYY-MM". */
  period: string;
  quotes: number;
  /** Sum of quoted midpoints, in the tenant's currency. Proves ROI to them. */
  quotedValue: number;
}
