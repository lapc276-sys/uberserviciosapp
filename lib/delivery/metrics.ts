import type { AccessObservation, ComponentMinutes, CounterObservation, TimeComponent } from './types';
import { COMPONENT_LABELS, TIME_COMPONENTS } from './types';
import { mean, percentile, round1, shrink } from './stats';

/**
 * What the engine learns about itself.
 *
 * Two reports live here, and they answer the only two questions that decide
 * whether any of this is real:
 *
 *   1. Is the model right? (calibration — per component, not just in total)
 *   2. Is the fleet's time being wasted? (idle gap)
 *
 * Component-level calibration is what makes the model fixable. "We're 6 minutes
 * over" tells you nothing; "we're 6 minutes over and 5 of them are prep wait at
 * one merchant" tells you exactly what to go do on Monday morning.
 */

/** What actually happened on a completed delivery. */
export interface JobOutcome {
  ref: string;
  courierId: string;
  merchantId: string;
  buildingId?: string | null;
  predicted: ComponentMinutes;
  /** Measured components. Partial — couriers' phones can't time everything. */
  actual: Partial<ComponentMinutes>;
  predictedTotalMinutes: number;
  actualTotalMinutes: number;
  /**
   * Minutes between finishing the previous delivery and starting productive
   * work on this one. Null for the first job of a shift.
   */
  idleGapMinutes: number | null;
  completedAt: string;
}

export interface ComponentAccuracy {
  component: TimeComponent;
  label: string;
  samples: number;
  predictedMean: number;
  actualMean: number;
  /** Positive = the model over-estimates this component. */
  biasMinutes: number;
  meanAbsErrorMinutes: number;
}

export interface CalibrationReport {
  jobs: number;
  /** Positive = the engine promises more time than the work takes. */
  biasMinutes: number;
  meanAbsErrorMinutes: number;
  /** Share of jobs where the estimate landed within 20% of reality. */
  within20Pct: number;
  components: ComponentAccuracy[];
  /** The component costing the model the most accuracy. */
  worstComponent: ComponentAccuracy | null;
}

export function calibrationReport(outcomes: JobOutcome[]): CalibrationReport {
  if (outcomes.length === 0) {
    return { jobs: 0, biasMinutes: 0, meanAbsErrorMinutes: 0, within20Pct: 0, components: [], worstComponent: null };
  }

  const errors = outcomes.map((o) => o.predictedTotalMinutes - o.actualTotalMinutes);
  const within = outcomes.filter(
    (o) => o.actualTotalMinutes > 0 && Math.abs(o.predictedTotalMinutes - o.actualTotalMinutes) / o.actualTotalMinutes <= 0.2,
  ).length;

  const components: ComponentAccuracy[] = TIME_COMPONENTS.map((component) => {
    const withActual = outcomes.filter((o) => typeof o.actual[component] === 'number');
    const predicted = withActual.map((o) => o.predicted[component]);
    const actual = withActual.map((o) => o.actual[component] as number);
    return {
      component,
      label: COMPONENT_LABELS[component],
      samples: withActual.length,
      predictedMean: round1(mean(predicted)),
      actualMean: round1(mean(actual)),
      biasMinutes: round1(mean(predicted) - mean(actual)),
      meanAbsErrorMinutes: round1(mean(withActual.map((_, i) => Math.abs(predicted[i] - actual[i])))),
    };
  }).filter((c) => c.samples > 0);

  const worst = [...components].sort((a, b) => b.meanAbsErrorMinutes - a.meanAbsErrorMinutes)[0] ?? null;

  return {
    jobs: outcomes.length,
    biasMinutes: round1(mean(errors)),
    meanAbsErrorMinutes: round1(mean(errors.map(Math.abs))),
    within20Pct: Math.round((within / outcomes.length) * 100),
    components,
    worstComponent: worst,
  };
}

export interface IdleGapReport {
  jobs: number;
  meanMinutes: number;
  p50Minutes: number;
  p90Minutes: number;
  /** Total minutes the fleet spent between jobs. This is the money number. */
  lostMinutes: number;
  /** Share of engaged time that was idle. */
  idleSharePct: number;
  byCourier: { courierId: string; jobs: number; meanMinutes: number }[];
}

/**
 * The idle gap: everything between "delivered" and "doing the next useful
 * thing". Riding to the next pickup counts. Standing at a counter counts.
 *
 * It is the metric that ties the whole system together, because almost every
 * decision the engine makes — hold the offer, batch or don't, stage here
 * instead of there — moves this number and only this number.
 */
export function idleGapReport(outcomes: JobOutcome[]): IdleGapReport {
  const gaps = outcomes.filter((o) => o.idleGapMinutes !== null);
  if (gaps.length === 0) {
    return { jobs: 0, meanMinutes: 0, p50Minutes: 0, p90Minutes: 0, lostMinutes: 0, idleSharePct: 0, byCourier: [] };
  }

  const values = gaps.map((o) => o.idleGapMinutes as number);
  const lost = values.reduce((s, v) => s + v, 0);
  const engaged = gaps.reduce((s, o) => s + o.actualTotalMinutes, 0) + lost;

  const byCourier = [...new Set(gaps.map((o) => o.courierId))].map((courierId) => {
    const mine = gaps.filter((o) => o.courierId === courierId);
    return {
      courierId,
      jobs: mine.length,
      meanMinutes: round1(mean(mine.map((o) => o.idleGapMinutes as number))),
    };
  }).sort((a, b) => b.meanMinutes - a.meanMinutes);

  return {
    jobs: gaps.length,
    meanMinutes: round1(mean(values)),
    p50Minutes: round1(percentile(values, 0.5)),
    p90Minutes: round1(percentile(values, 0.9)),
    lostMinutes: Math.round(lost),
    idleSharePct: engaged > 0 ? Math.round((lost / engaged) * 100) : 0,
    byCourier,
  };
}

/**
 * A courier's personal pace: the ratio between how long they actually take and
 * what the model predicted, shrunk toward 1.
 *
 * "This courier finishes 15% faster than the ETA" is not a compliment, it is a
 * dispatch input — it changes who should get the job with the tight window.
 */
export function paceFactorFor(courierId: string, outcomes: JobOutcome[]): number {
  const ratios = outcomes
    .filter((o) => o.courierId === courierId && o.predictedTotalMinutes > 0)
    .map((o) => o.actualTotalMinutes / o.predictedTotalMinutes)
    .filter((r) => r > 0.4 && r < 2.5);

  return Math.round(shrink(1, ratios, 8) * 100) / 100;
}

/**
 * Turns a completed job into the observation records the models learn from.
 *
 * Everything here is a byproduct of doing the work — arrival and departure
 * timestamps the courier app already has. Nobody fills in a form. That is the
 * only kind of data collection that survives contact with a real operation.
 *
 * Prep time is deliberately absent: it is measured merchant-side (placed →
 * marked ready), not from the courier's clock.
 */
export function outcomeToObservations(
  o: JobOutcome,
  floor: number | null,
): { counter: CounterObservation | null; access: AccessObservation | null } {
  const accessMinutes = (o.actual.building_entry ?? 0) + (o.actual.vertical ?? 0) + (o.actual.walk ?? 0);

  return {
    counter:
      typeof o.actual.merchant_counter === 'number'
        ? { merchantId: o.merchantId, seconds: Math.round(o.actual.merchant_counter * 60), at: o.completedAt }
        : null,
    access:
      o.buildingId && accessMinutes > 0
        ? {
            buildingId: o.buildingId,
            floor,
            seconds: Math.round(accessMinutes * 60),
            usedElevator: null,
            at: o.completedAt,
          }
        : null,
  };
}
