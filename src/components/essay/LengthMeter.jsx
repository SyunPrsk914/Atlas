import { AlertTriangle, CheckCircle2, Ruler } from 'lucide-react';
import { formatLimit } from '@/lib/essayScope';

/**
 * The length contract, drawn.
 *
 * A counter that says "480 / 650" tells an applicant they are allowed to write
 * more. It does not tell them that 480 is a failing length for a 650-word
 * prompt. This meter shows the band a finished draft has to land in, where the
 * current draft sits inside it, and says plainly what to do about it.
 *
 * @param {object} assessment from `assessLength()` in src/lib/essayLength.js
 */
export default function LengthMeter({ assessment, compact = false }) {
  if (!assessment) return null;
  const { count, limit, targetLow, hardFloor, unit, state } = assessment;
  const words = formatLimit(unit);
  // Scale the bar to whichever is larger, so an over-length draft is visible.
  const scale = Math.max(limit, count, targetLow, 1) * 1.04;
  const pct = (value) => `${Math.min(100, Math.max(0, (value / scale) * 100))}%`;

  const tone = {
    ok: { text: 'text-green-700', bar: 'bg-green-500', icon: CheckCircle2, label: 'Inside the target band' },
    short: { text: 'text-amber-700', bar: 'bg-amber-500', icon: AlertTriangle, label: 'Under the target band' },
    severe: { text: 'text-red-700', bar: 'bg-red-500', icon: AlertTriangle, label: 'Far too short' },
    empty: { text: 'text-foreground/40', bar: 'bg-foreground/20', icon: Ruler, label: 'Not written yet' },
    over: { text: 'text-red-700', bar: 'bg-red-600', icon: AlertTriangle, label: 'Over the ceiling' },
  }[state] || { text: 'text-foreground/50', bar: 'bg-muted-foreground', icon: Ruler, label: '' };
  const Icon = tone.icon;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <span className={`text-xs font-medium inline-flex items-center gap-1.5 ${tone.text}`}>
          <Icon className="w-3.5 h-3.5" />
          {count.toLocaleString()} / {limit ? limit.toLocaleString() : '—'} {words}
          {!compact && <span className="text-foreground/35 font-normal">· target {targetLow.toLocaleString()}–{limit.toLocaleString()}</span>}
          {state === 'over' && ` · ${assessment.overage.toLocaleString()} over`}
        </span>
        {!compact && (
          <span className="text-[11px] text-foreground/35">{tone.label}</span>
        )}
      </div>

      <div className="relative h-2 rounded-full bg-muted overflow-hidden">
        {/* Below the hard floor: a stub. */}
        <div className="absolute inset-y-0 left-0 bg-red-100" style={{ width: pct(Math.min(hardFloor, limit)) }} />
        {/* Hard floor to target: short. */}
        <div
          className="absolute inset-y-0 bg-amber-100"
          style={{ left: pct(Math.min(hardFloor, limit)), width: `${Math.max(0, parseFloat(pct(Math.min(targetLow, limit))) - parseFloat(pct(Math.min(hardFloor, limit))))}%` }}
        />
        {/* The target band. */}
        <div
          className="absolute inset-y-0 bg-green-100"
          style={{ left: pct(Math.min(targetLow, limit)), width: `${Math.max(0, parseFloat(pct(limit)) - parseFloat(pct(Math.min(targetLow, limit))))}%` }}
        />
        {/* Where this draft actually is. */}
        <div
          className={`absolute inset-y-0 left-0 ${tone.bar} opacity-80`}
          style={{ width: pct(count) }}
        />
        {count > limit && (
          <div className="absolute inset-y-0 bg-red-600" style={{ left: pct(limit), width: `${Math.max(1, parseFloat(pct(count)) - parseFloat(pct(limit)))}%` }} />
        )}
      </div>

      {!compact && assessment.needsWork && count > 0 && (
        <p className={`text-[11px] leading-relaxed ${tone.text}`}>
          {state === 'over'
            ? `${assessment.overage.toLocaleString()} ${words} over the ceiling. The portal will not accept this — cut sentences that only announce meaning.`
            : `${assessment.shortfall.toLocaleString()} more ${words} of real material would land this draft in the band. Deepen the scenes you already have; do not pad.`}
        </p>
      )}
    </div>
  );
}
