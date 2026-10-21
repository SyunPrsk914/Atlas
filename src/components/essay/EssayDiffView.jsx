import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  AlertTriangle, Check, CornerUpLeft, Eye, EyeOff, FileDiff, ListChecks, ShieldCheck, Target, Wand2,
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
 *   preservedEstimate, why, protectedItems, gaps, at, unit, unaddressed,
 *   resolvedPhrases, refused, unaddressedNote, instructionCheck, scoreBefore,
 *   scoreAfter, scoreDelta, autoRestored, restoreReason, notApplied, notAppliedReasons }
 */
export default function EssayDiffView({ revision, onKeep, onRestore, onFixRemaining, restoring = false, disabled = false }) {
  const [showRemoved, setShowRemoved] = useState(true);

  if (!revision || !revision.ops?.length) return null;

  const { ops, stats, unit = 'words' } = revision;
  const words = formatLimit(unit);
  const rewritten = isAggressiveRewrite(stats);
  const changes = (revision.changes || []).filter((change) => change && (change.original || change.revised));
  // Whether the edit answered the review. Atlas measures this itself: a change
  // log written by the same model that made the edit is a claim, while a flagged
  // phrase still sitting in the text is a fact.
  const unaddressed = (revision.unaddressed || []).filter(Boolean);
  const resolved = (revision.resolvedPhrases || []).filter(Boolean);
  const refused = (revision.refused || []).filter((item) => item && (item.phrase || item.reason));
  // The applicant's own instructions, checked against the text where they quote
  // words, and shown as the editor's claim (marked) where they do not.
  const instructionItems = (revision.instructionCheck?.items || []).filter((item) => item && item.instruction);
  const instructionsMissed = instructionItems.filter((item) => item.status === 'missed');
  // A re-score that did not move is not an improvement, whatever the editor
  // says; a lower one is a regression. Only a higher score earns green.
  const delta = revision.scoreDelta;
  const scoreTone = delta == null
    ? 'border-border bg-muted/30 text-foreground/70'
    : delta < 0
      ? 'border-red-200 bg-red-50 text-red-800'
      : delta === 0
        ? 'border-amber-200 bg-amber-50 text-amber-800'
        : 'border-green-200 bg-green-50 text-green-800';

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
              <p className="font-medium">
                {revision.notApplied
                  ? 'This edit was not applied to your essay.'
                  : 'This is a rewrite, not an edit.'}
              </p>
              <p className="mt-0.5">
                Only {percent(stats.preservedRatio)} of your own words survived. Atlas asks the editor to keep at
                least 80% of your draft and to change only what has to change.
                {revision.notApplied
                  ? (revision.redo
                    ? ' The editor was sent back once and its second answer did the same, so your version stayed in the editor. This one is kept here for reference — you have lost nothing.'
                    : ' Atlas measured this answer and did not apply it, so your version stayed in the editor. It is kept here for reference — you have lost nothing.')
                  : ' Read it before you keep it — or restore your version and try the edit again.'}
              </p>
              {Array.isArray(revision.notAppliedReasons) && revision.notAppliedReasons.length > 0 && (
                <ul className="mt-1.5 space-y-0.5 text-[11px] text-red-700/90">
                  {revision.notAppliedReasons.map((reason, index) => (
                    <li key={index}>· {reason}</li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}

        {unaddressed.length > 0 && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
            <div className="flex items-start gap-2.5">
              <Target className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
              <div className="flex-1 text-xs text-amber-900 leading-relaxed">
                <p className="font-medium">
                  {unaddressed.length} phrase{unaddressed.length === 1 ? '' : 's'} the review objected to {unaddressed.length === 1 ? 'is' : 'are'} still in your draft
                </p>
                <ul className="mt-1.5 space-y-1">
                  {unaddressed.map((phrase, index) => (
                    <li key={index} className="font-mono text-[11px] bg-white/70 border border-amber-200 rounded px-1.5 py-0.5 break-words">“{phrase}”</li>
                  ))}
                </ul>
                <p className="mt-1.5 text-[11px] text-amber-800/90">
                  The editor may still have improved the essay — but it did not do the job it was given, so the score has no reason to rise.
                </p>
                {resolved.length > 0 && (
                  <p className="mt-1 text-[11px] text-amber-800/80">{resolved.length} of the review's flagged phrase{resolved.length === 1 ? ' is' : 's are'} already gone.</p>
                )}
              </div>
              {onFixRemaining && (
                <Button size="sm" onClick={onFixRemaining} disabled={disabled} className="shrink-0">
                  <Wand2 className="w-3.5 h-3.5 mr-1.5" />
                  Fix what is still flagged
                </Button>
              )}
            </div>
          </div>
        )}

        {instructionItems.length > 0 && (
          <div className={`rounded-lg border px-3 py-2.5 text-xs ${instructionsMissed.length
            ? 'border-amber-200 bg-amber-50 text-amber-900'
            : 'border-border bg-muted/30 text-foreground/70'}`}>
            <p className="font-medium flex items-center gap-1.5">
              <ListChecks className="w-3.5 h-3.5 shrink-0" />
              Your edit instructions — {instructionsMissed.length
                ? `${instructionsMissed.length} of ${instructionItems.length} not carried out`
                : `${instructionItems.length} checked`}
            </p>
            <ul className="mt-1.5 space-y-1">
              {instructionItems.slice(0, 12).map((item, index) => {
                const tone = item.status === 'missed' ? 'text-red-700' : item.status === 'done' ? 'text-green-700' : item.status === 'declined' ? 'text-amber-700' : 'text-foreground/50';
                const mark = item.status === 'missed' ? 'Not done' : item.status === 'done' ? 'Done' : item.status === 'declined' ? 'Declined' : item.status === 'reported' ? 'Reported done' : 'Unverified';
                return (
                  <li key={index} className="flex items-start gap-2">
                    <span className={`shrink-0 font-semibold uppercase tracking-wide text-[10px] mt-px ${tone}`}>{mark}</span>
                    <span className="min-w-0">
                      <span className="text-foreground/80">{item.instruction}</span>
                      {item.detail && <span className="text-foreground/45"> — {item.detail}</span>}
                    </span>
                  </li>
                );
              })}
            </ul>
            {instructionsMissed.length > 0 && onFixRemaining && (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {unaddressed.length === 0 && (
                  <Button size="sm" onClick={onFixRemaining} disabled={disabled}>
                    <Wand2 className="w-3.5 h-3.5 mr-1.5" />
                    Carry out the missed instructions
                  </Button>
                )}
                <p className="text-[11px]">
                  {unaddressed.length
                    ? '“Fix what is still flagged” sends these back to the editor together with the flagged phrases.'
                    : 'A follow-up edit that does only these, and leaves everything else word for word.'}
                </p>
              </div>
            )}
          </div>
        )}

        {revision.scoreAfter != null && (
          <div className={`flex flex-wrap items-center gap-2 text-xs rounded-lg border px-3 py-2 ${scoreTone}`}>
            <span className="font-medium">
              Re-scored on the same rubric: {revision.scoreBefore ?? '—'} → {revision.scoreAfter}/10
              {delta != null && delta !== 0
                ? ` (${delta > 0 ? '+' : ''}${delta})` : ''}
            </span>
            <span className="text-[11px] opacity-80">
              {delta < 0
                ? (revision.autoRestored
                  ? `Atlas put your previous version back: ${revision.restoreReason || 'the revision scored lower'}. The edit is kept here for reference.`
                  : 'The revision scored lower — this is not an improvement. Restore your version, or fix what is still flagged below.')
                : revision.autoRestored
                  ? `Atlas put your previous version back: ${revision.restoreReason}. The edit is kept here for reference.`
                  : delta === 0
                    ? 'The score did not move. Atlas kept this edit only because every finding and instruction it was asked to answer is answered in the text.'
                    : 'Measured by Atlas on the text now in the editor, not by the editor itself.'}
            </span>
          </div>
        )}

        {unaddressed.length === 0 && resolved.length > 0 && (
          <p className="text-[11px] text-green-700 flex items-start gap-1.5">
            <Check className="w-3.5 h-3.5 mt-px shrink-0" />
            Every phrase the review objected to is now out of the draft ({resolved.length} changed or removed), so this edit answered the review rather than re-polishing around it.
          </p>
        )}

        {refused.length > 0 && (
          <div className="text-[11px] text-foreground/50 leading-relaxed">
            <p className="font-medium text-foreground/60">Left in on purpose, by the editor:</p>
            <ul className="mt-1 space-y-0.5">
              {refused.slice(0, 8).map((item, index) => (
                <li key={index}>“{item.phrase || ''}”{item.reason ? ` — ${item.reason}` : ''}</li>
              ))}
            </ul>
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
          {revision.summary && (
            <p className="text-sm text-foreground/70 leading-relaxed">{revision.summary}</p>
          )}
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
