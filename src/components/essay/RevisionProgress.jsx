import { History, TrendingUp, TrendingDown, Minus, Trash2 } from 'lucide-react';

const ACTION_LABELS = {
  generate: 'Draft written',
  repair: 'Length fixed',
  edit: 'Edits applied',
  review: 'Review',
  restore: 'Restored your version',
  manual: 'Your own edit',
};

function Delta({ before, after, suffix = '' }) {
  const hasBoth = Number.isFinite(Number(before)) && Number.isFinite(Number(after)) && Number(before) > 0;
  if (!hasBoth) {
    return Number.isFinite(Number(after)) && Number(after) > 0
      ? <span className="text-xs text-foreground/60">{Number(after)}{suffix}</span>
      : <span className="text-xs text-foreground/30">not scored</span>;
  }
  const delta = Math.round((Number(after) - Number(before)) * 10) / 10;
  const Icon = delta > 0 ? TrendingUp : delta < 0 ? TrendingDown : Minus;
  const colour = delta > 0 ? 'text-green-700' : delta < 0 ? 'text-red-600' : 'text-foreground/40';
  return (
    <span className={`text-xs font-medium inline-flex items-center gap-1 ${colour}`}>
      <Icon className="w-3 h-3" />
      {Number(before)} → {Number(after)}{suffix}{delta !== 0 && ` (${delta > 0 ? '+' : ''}${delta})`}
    </span>
  );
}

/**
 * What each AI action did to this essay, and whether the score actually moved.
 *
 * Without this, "the review never improves after I edit" is unfalsifiable: two
 * reviews days apart could differ because of the edit or because of the model.
 * Atlas records the score it had before an edit and the score it measured
 * after, on the same rubric, in the same session.
 */
export default function RevisionProgress({ entries = [], onClear }) {
  if (!entries?.length) return null;
  const scored = entries.filter((entry) => Number(entry.scoreAfter) > 0);
  const best = scored.length ? Math.max(...scored.map((entry) => Number(entry.scoreAfter))) : null;
  const latest = scored.length ? Number(scored[scored.length - 1].scoreAfter) : null;
  const recent = [...entries].reverse().slice(0, 6);

  return (
    <div className="bg-card border border-border rounded-xl p-4">
      <div className="flex items-center justify-between gap-2 mb-2.5">
        <h4 className="text-sm font-medium flex items-center gap-1.5 text-foreground/60">
          <History className="w-3.5 h-3.5" /> Progress on this essay
        </h4>
        <div className="flex items-center gap-3">
          {best !== null && latest !== null && (
            <span className="text-[11px] text-foreground/40">
              latest <span className="font-medium text-foreground/65">{latest}/10</span>
              {best !== latest && <> · best <span className="font-medium text-foreground/65">{best}/10</span></>}
            </span>
          )}
          {onClear && (
            <button onClick={onClear} className="text-foreground/25 hover:text-destructive transition" title="Clear this history">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      <ol className="space-y-1.5">
        {recent.map((entry, index) => (
          <li key={index} className="flex items-start gap-2.5 text-xs">
            <span className="text-foreground/25 font-mono shrink-0 w-16 pt-px">
              {new Date(entry.at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
            </span>
            <span className="text-foreground/60 shrink-0 w-32">
              {ACTION_LABELS[entry.action] || entry.action || 'Change'}
            </span>
            <span className="text-foreground/40 shrink-0">
              {Number.isFinite(Number(entry.wordsBefore)) && Number.isFinite(Number(entry.wordsAfter))
                ? `${entry.wordsBefore} → ${entry.wordsAfter} ${entry.unit === 'characters' ? 'chars' : 'w'}`
                : ''}
            </span>
            <Delta before={entry.scoreBefore} after={entry.scoreAfter} />
            {entry.note && <span className="text-foreground/35 truncate" title={entry.note}>{entry.note}</span>}
          </li>
        ))}
      </ol>
      {entries.length > recent.length && (
        <p className="text-[11px] text-foreground/30 mt-2">
          {entries.length - recent.length} earlier {entries.length - recent.length === 1 ? 'change' : 'changes'} kept in this browser.
        </p>
      )}
    </div>
  );
}
