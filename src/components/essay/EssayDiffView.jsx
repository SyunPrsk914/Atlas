import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  AlertTriangle, Check, CornerUpLeft, Eye, EyeOff, FileDiff, ShieldCheck,
} from 'lucide-react';
import { isAggressiveRewrite } from '@/lib/textDiff';
import { formatLimit } from '@/lib/essayScope';

const percent = (ratio) => `${Math.round((Number(ratio) || 0) * 100)}%`;

function Stat({ label, value, tone = '' }) {
  return (
    <div className="rounded-lg border border-border bg-muted/20 px-2.5 py-1.5">
      <div className={`text-sm font-semibold ${tone}`}>{value}</div>
      <div className="text-[10px] uppercase tracking-wide text-foreground/40">{label}</div>
    </div>
  );
}

/**
 * Original -> edited, with every word the AI touched highlighted.
 *
 * Atlas used to replace the draft and say "read the diff carefully", which
 * assumed a diff the applicant did not have. This is that diff: word-level,
 * colour-coded, with the editor's own change log and reasons underneath, and a
 * one-click restore of the version that was on the page before the edit.
 *
 * @param {object} revision { before, after, ops, stats, changes, notes,
 *   preservedEstimate, why, protectedItems, gaps, at, unit }
 */
export default function EssayDiffView({ revision, onKeep, onRestore, restoring = false }) {
  const [showRemoved, setShowRemoved] = useState(true);

  if (!revision || !revision.ops?.length) return null;

  const { ops, stats, unit = 'words' } = revision;
  const words = formatLimit(unit);
  const rewritten = isAggressiveRewrite(stats);
  const changes = (revision.changes || []).filter((change) => change && (change.original || change.revised));

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-5 py-3.5 border-b border-border flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <FileDiff className="w-4 h-4 text-accent shrink-0" />
          <span className="font-display text-base font-semibold">What the editor changed</span>
          {revision.at && (
            <span className="text-[11px] text-foreground/35 shrink-0">
              {new Date(revision.at).toLocaleString()}
            </span>
          )}
        </div>
        <Button size="sm" variant="ghost" onClick={() => setShowRemoved((v) => !v)} className="shrink-0">
          {showRemoved ? <EyeOff className="w-3.5 h-3.5 mr-1.5" /> : <Eye className="w-3.5 h-3.5 mr-1.5" />}
          {showRemoved ? 'Hide cut text' : 'Show cut text'}
        </Button>
      </div>

      <div className="px-5 py-3.5 border-b border-border space-y-3">
        <div className="flex flex-wrap gap-2">
          <Stat label={`${words} kept`} value={stats.kept} />
          <Stat label="added" value={`+${stats.added}`} tone="text-emerald-700" />
          <Stat label="cut" value={`-${stats.removed}`} tone="text-red-600" />
          <Stat label="your draft survived" value={percent(stats.preservedRatio)} tone={rewritten ? 'text-red-600' : 'text-green-700'} />
          <Stat label="length" value={`${stats.oldTotal} → ${stats.newTotal}`} />
        </div>

        <div className="flex items-center gap-3 text-[11px] text-foreground/45 flex-wrap">
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block w-3 h-3 rounded-sm bg-emerald-100 border border-emerald-300" />
            words the editor wrote or changed
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block w-3 h-3 rounded-sm bg-red-50 border border-red-200 line-through decoration-red-400" />
            words it cut
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block w-3 h-3 rounded-sm bg-muted border border-border" />
            your words, untouched
          </span>
        </div>

        {rewritten && (
          <div className="flex items-start gap-2.5 rounded-lg border border-red-200 bg-red-50 p-3">
            <AlertTriangle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
            <div className="text-xs text-red-800 leading-relaxed">
              <p className="font-medium">This is a rewrite, not an edit.</p>
              <p className="mt-0.5">
                Only {percent(stats.preservedRatio)} of your own words survived. Atlas asks the editor to keep at
                least 80% of your draft and to change only what has to change, so this answer broke its own rules.
                Read it before you keep it — or restore your version and try the edit again.
              </p>
            </div>
          </div>
        )}
      </div>

      <div className="px-5 py-4 max-h-[28rem] overflow-y-auto bg-background/60">
        <p className="text-sm leading-relaxed whitespace-pre-wrap font-body">
          {ops.map((op, index) => {
            if (!op.word) return <span key={index}>{op.space}</span>;
            if (op.type === 'del' && !showRemoved) return null;
            if (op.type === 'add') {
              return (
                <span key={index} className="rounded-[3px] bg-emerald-100 px-0.5 font-semibold text-emerald-950 decoration-emerald-500">
                  {op.word}{op.space}
                </span>
              );
            }
            if (op.type === 'del') {
              return (
                <span key={index} className="rounded-[3px] bg-red-50 px-0.5 text-foreground/40 line-through decoration-red-400/70">
                  {op.word}{op.space}
                </span>
              );
            }
            return <span key={index}>{op.word}{op.space}</span>;
          })}
        </p>
      </div>

      {(revision.why || changes.length > 0 || revision.protectedItems?.length > 0 || revision.gaps?.length > 0) && (
        <div className="px-5 py-4 border-t border-border space-y-4">
          {revision.why && (
            <div>
              <h4 className="text-xs font-medium text-foreground/50 mb-1">Why the editor says this scores higher</h4>
              <p className="text-sm text-foreground/65 leading-relaxed">{revision.why}</p>
            </div>
          )}

          {changes.length > 0 && (
            <div>
              <h4 className="text-xs font-medium text-foreground/50 mb-2">
                The editor&apos;s own change log ({changes.length})
              </h4>
              <ul className="space-y-2">
                {changes.slice(0, 40).map((change, index) => (
                  <li key={index} className="rounded-lg border border-border bg-muted/20 p-2.5 space-y-1">
                    {change.original && (
                      <p className="text-xs text-foreground/45 line-through decoration-red-300">“{change.original}”</p>
                    )}
                    {change.revised && (
                      <p className="text-xs text-foreground/80 font-medium bg-emerald-50 rounded px-1.5 py-1 inline-block">“{change.revised}”</p>
                    )}
                    {!change.revised && <p className="text-[11px] text-red-600">cut</p>}
                    {change.reason && <p className="text-[11px] text-foreground/50 leading-relaxed">{change.reason}</p>}
                  </li>
                ))}
              </ul>
              {changes.length > 40 && (
                <p className="text-[11px] text-foreground/35 mt-1.5">…and {changes.length - 40} more changes.</p>
              )}
            </div>
          )}

          {revision.protectedItems?.length > 0 && (
            <div>
              <h4 className="text-xs font-medium text-green-700 mb-1.5 inline-flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5" /> Left alone on purpose
              </h4>
              <ul className="space-y-1">
                {revision.protectedItems.slice(0, 8).map((item, index) => (
                  <li key={index} className="text-xs text-foreground/55 flex gap-2">
                    <span className="text-green-500 mt-0.5">•</span>{item}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {revision.gaps?.length > 0 && (
            <div>
              <h4 className="text-xs font-medium text-foreground/50 mb-1.5">Facts the editor needed but did not have</h4>
              <ul className="space-y-1">
                {revision.gaps.map((item, index) => (
                  <li key={index} className="text-xs text-foreground/55 flex gap-2">
                    <span className="text-accent">→</span>{item}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      <div className="flex items-center justify-between gap-3 px-5 py-3.5 border-t border-border bg-muted/20 flex-wrap">
        <p className="text-[11px] text-foreground/45 max-w-md">
          The revision is already saved. Nothing is lost either way — your pre-edit version is kept in this browser.
        </p>
        <div className="flex items-center gap-2">
          {onRestore && (
            <Button size="sm" variant="outline" onClick={onRestore} disabled={restoring}>
              <CornerUpLeft className="w-3.5 h-3.5 mr-1.5" />
              {restoring ? 'Restoring…' : 'Restore my version'}
            </Button>
          )}
          {onKeep && (
            <Button size="sm" onClick={onKeep}>
              <Check className="w-3.5 h-3.5 mr-1.5" />
              Keep this revision
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
