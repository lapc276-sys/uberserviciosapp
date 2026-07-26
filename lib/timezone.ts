/**
 * Timezone-correct scheduling.
 *
 * Bookings are stored as local wall-clock strings ("2026-08-15", "10:00 AM")
 * because that's what the customer agreed to. The server runs in UTC, so every
 * comparison ("is this 24h away?") must resolve the wall-clock time against the
 * market's IANA timezone. Comparing date strings against a UTC "today" is wrong
 * the moment you operate outside a single timezone — and wrong at the day
 * boundary even inside one.
 */

/** Minutes that `tz` is offset from UTC at the given instant (DST-aware). */
function tzOffsetMinutes(at: Date, tz: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts: Record<string, string> = {};
  for (const p of dtf.formatToParts(at)) parts[p.type] = p.value;
  // `hour` can come back as "24" at midnight in some ICU versions.
  const hour = parts.hour === '24' ? 0 : Number(parts.hour);
  const asIfUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    hour,
    Number(parts.minute),
    Number(parts.second),
  );
  return (asIfUtc - at.getTime()) / 60000;
}

/** Parses "10:00 AM" / "2:30 PM" / "14:30" into {hour, minute}. */
export function parseTimeOfDay(time: string): { hour: number; minute: number } {
  const match = time.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
  if (!match) return { hour: 9, minute: 0 };
  let hour = Number(match[1]);
  const minute = Number(match[2]);
  const meridiem = match[3]?.toUpperCase();
  if (meridiem === 'PM' && hour !== 12) hour += 12;
  if (meridiem === 'AM' && hour === 12) hour = 0;
  return { hour, minute };
}

/**
 * Resolves a local wall-clock date+time in `tz` to the real UTC instant.
 * Two-pass so DST transitions land on the correct offset.
 */
export function zonedToInstant(date: string, time: string, tz: string): Date | null {
  const [y, m, d] = date.split('-').map(Number);
  if (!y || !m || !d) return null;
  const { hour, minute } = parseTimeOfDay(time);

  const naive = Date.UTC(y, m - 1, d, hour, minute);
  const firstOffset = tzOffsetMinutes(new Date(naive), tz);
  let instant = naive - firstOffset * 60000;
  const secondOffset = tzOffsetMinutes(new Date(instant), tz);
  if (secondOffset !== firstOffset) instant = naive - secondOffset * 60000;
  return new Date(instant);
}

/** Today's date (YYYY-MM-DD) as seen in `tz`. */
export function localDate(tz: string, offsetDays = 0): string {
  const at = new Date();
  at.setDate(at.getDate() + offsetDays);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);
}

/** Hours from now until the booking starts. Negative once it has passed. */
export function hoursUntil(date: string, time: string, tz: string, now = new Date()): number | null {
  const instant = zonedToInstant(date, time, tz);
  if (!instant) return null;
  return (instant.getTime() - now.getTime()) / 3_600_000;
}
