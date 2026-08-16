'use client';

import { useState } from 'react';
import { Ruler, X } from 'lucide-react';

/**
 * Optional room measurement, designed to be usable without a tape measure.
 *
 * The point is not survey accuracy — it is finding out whether area predicts
 * cleaning time at all. A paced estimate within ~15% answers that question
 * perfectly well, and a tool that demanded precision would simply be skipped
 * on a real job, which yields no data instead of rough data.
 *
 * Everything here is skippable on purpose. A pro who is running late must be
 * able to finish the capture without measuring, because a blocked capture
 * loses the soil scores too — and those are the ones we cannot reconstruct.
 */

/** An adult stride is close enough to 2.5 ft for this purpose. */
const FEET_PER_PACE = 2.5;

const PRESETS: { label: string; w: number; l: number }[] = [
  { label: 'Small bath', w: 5, l: 8 },
  { label: 'Bathroom', w: 8, l: 10 },
  { label: 'Bedroom', w: 11, l: 12 },
  { label: 'Kitchen', w: 10, l: 12 },
  { label: 'Living room', w: 14, l: 18 },
];

const field =
  'w-full rounded-lg border bg-white px-2 py-2 text-center text-sm outline-none focus:border-brand-400 dark:bg-white/5';

export function RoomSize({
  value,
  onChange,
}: {
  value: number | undefined;
  onChange: (sqft: number | undefined) => void;
}) {
  const [open, setOpen] = useState(false);
  const [width, setWidth] = useState('');
  const [length, setLength] = useState('');
  const [unit, setUnit] = useState<'ft' | 'paces'>('paces');

  function apply(w: string, l: string, u: 'ft' | 'paces') {
    const wn = Number(w);
    const ln = Number(l);
    if (!wn || !ln || wn <= 0 || ln <= 0) return;
    const factor = u === 'paces' ? FEET_PER_PACE : 1;
    onChange(Math.round(wn * factor * ln * factor));
  }

  if (value && !open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-3 inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-slate-100 px-3 text-sm font-medium dark:bg-white/10"
      >
        <Ruler className="h-4 w-4" /> {value} sq ft
        <span className="text-xs font-normal text-slate-500">· cambiar</span>
      </button>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-3 inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-dashed px-3 text-sm text-slate-500"
      >
        <Ruler className="h-4 w-4" /> Medir la habitación <span className="text-xs">(opcional)</span>
      </button>
    );
  }

  return (
    <div className="mt-3 rounded-xl border bg-slate-50 p-3 dark:bg-white/5">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">Tamaño de la habitación</p>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Cerrar"
          className="grid h-9 w-9 place-items-center rounded-lg text-slate-400"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="mt-2 flex gap-1 rounded-lg bg-white p-1 text-xs dark:bg-white/10">
        {(['paces', 'ft'] as const).map((u) => (
          <button
            key={u}
            type="button"
            onClick={() => {
              setUnit(u);
              apply(width, length, u);
            }}
            className={`min-h-[36px] flex-1 rounded-md font-medium ${
              unit === u ? 'bg-brand-600 text-white' : 'text-slate-500'
            }`}
          >
            {u === 'paces' ? 'Pasos' : 'Pies'}
          </button>
        ))}
      </div>

      {unit === 'paces' && (
        <p className="mt-2 text-[11px] leading-snug text-slate-500">
          Cuenta los pasos de pared a pared, en las dos direcciones. Un paso ≈ 2,5 pies. No hace falta precisión:
          con acercarse un 15% ya sirve.
        </p>
      )}

      <div className="mt-2 flex items-center gap-2">
        <input
          type="number"
          inputMode="decimal"
          min="0"
          placeholder="ancho"
          value={width}
          onChange={(e) => {
            setWidth(e.target.value);
            apply(e.target.value, length, unit);
          }}
          className={field}
        />
        <span className="text-slate-400">×</span>
        <input
          type="number"
          inputMode="decimal"
          min="0"
          placeholder="largo"
          value={length}
          onChange={(e) => {
            setLength(e.target.value);
            apply(width, e.target.value, unit);
          }}
          className={field}
        />
      </div>

      <div className="mt-2 flex flex-wrap gap-1.5">
        {PRESETS.map((p) => (
          <button
            key={p.label}
            type="button"
            onClick={() => {
              setUnit('ft');
              setWidth(String(p.w));
              setLength(String(p.l));
              apply(String(p.w), String(p.l), 'ft');
            }}
            className="min-h-[36px] rounded-lg border px-2.5 text-xs text-slate-600 dark:text-slate-300"
          >
            {p.label} <span className="text-slate-400">{p.w * p.l}</span>
          </button>
        ))}
      </div>

      <div className="mt-2 flex items-center justify-between">
        <p className="text-sm">
          {value ? (
            <>
              <span className="font-semibold">{value}</span> sq ft
            </>
          ) : (
            <span className="text-slate-400">sin medir</span>
          )}
        </p>
        {value !== undefined && (
          <button
            type="button"
            onClick={() => {
              onChange(undefined);
              setWidth('');
              setLength('');
            }}
            className="min-h-[36px] px-2 text-xs font-medium text-slate-500 underline"
          >
            borrar
          </button>
        )}
      </div>
    </div>
  );
}
