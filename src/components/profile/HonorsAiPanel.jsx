import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Loader2, Wand2, Sparkles, X, Check, AlertTriangle, KeyRound } from 'lucide-react';
import { runAI } from '@/lib/ai';
import { hasLiveModel, isLiveOutcome } from '@/lib/aiOutcome';
import { diffText, diffStats } from '@/lib/textDiff';
import { startBackgroundTask, findRunningTask } from '@/lib/backgroundTasks';
import { useBackgroundTasks } from '@/hooks/use-background-tasks';
import { getStored, setStored } from '@/lib/persist';
import {
  HONOR_LIMITS, buildHonorPolishPrompt, HONOR_POLISH_SCHEMA, sanitizeHonorPolish, honorPolishDiffers,
} from '@/lib/honorPrompts';

const LIST_NOTE_KEY = 'honorsListNote';

/**
 * Results outlive the page: the polish runs as a background task and parks its
 * proposals here, exactly like the activities panel does.
 */
const memory = { polish: null };

const sameHonorText = (a, b) => ['name', 'grade_level', 'level']
  .every((field) => String(a?.[field] || '').trim() === String(b?.[field] || '').trim());

/** One name field, with the AI's rewrite highlighted word by word. */
function NameDiff({ before, after }) {
  if (!before || before === after) {
    return <p className="text-sm text-foreground/75 leading-relaxed break-words">{after}</p>;
  }
  const { ops } = diffText(before, after);
  const stats = diffStats(ops);
  return (
    <div>
      <p className="text-sm leading-relaxed break-words whitespace-pre-wrap">
        {ops.map((op, index) => {
          if (!op.word) return <span key={index}>{op.space}</span>;
          if (op.type === 'add') {
            return <span key={index} className="rounded-[3px] bg-emerald-100 px-0.5 font-semibold text-emerald-950">{op.word}{op.space}</span>;
          }
          if (op.type === 'del') {
            return <span key={index} className="rounded-[3px] bg-red-50 px-0.5 text-foreground/35 line-through decoration-red-300">{op.word}{op.space}</span>;
          }
          return <span key={index} className="text-foreground/70">{op.word}{op.space}</span>;
        })}
      </p>
      <p className="text-[10px] text-foreground/35 mt-1">
        {stats.kept} of your {stats.oldTotal} words kept · {stats.added} added · {stats.removed} cut
      </p>
    </div>
  );
}

/**
 * AI help for the honors list — sharpening only.
 *
 * There is no "suggest honors" here on purpose: the applicant asked for a
 * tool that makes the wording land, not one that invents entries. Every
 * proposal rewrites the NAME from facts that already exist in the entry, its
 * private note, the profile, or the materials, is shown as a word diff, and is
 * only applied when the applicant presses Apply. A proposal that changed
 * nothing is said so, not dressed up as an improvement.
 *
 * @param {object} props
 * @param {Array} props.honors            current list
 * @param {Function} props.onChange       replaces the whole list
 * @param {Function} props.getContext     async () => { profileText, materialsText, applicantText }
 * @param {number|null} props.sharpenIndex  entry the applicant asked to sharpen from the row
 * @param {Function} props.onSharpenDone  called once that request has been picked up
 */
export default function HonorsAiPanel({
  honors = [], onChange, getContext, sharpenIndex = null, onSharpenDone = () => {},
}) {
  const [polish, setPolish] = useState(() => memory.polish);
  const [listNote, setListNote] = useState(() => String(getStored(LIST_NOTE_KEY, null)?.text || ''));
  const [noteOpen, setNoteOpen] = useState(() => Boolean(getStored(LIST_NOTE_KEY, null)?.text));
  useEffect(() => { memory.polish = polish; }, [polish]);

  const onTaskChange = useCallback((task) => {
    if (task.kind !== 'honors' || task.state === 'running') return;
    setPolish(memory.polish);
  }, []);
  const tasks = useBackgroundTasks(onTaskChange);
  const runningTask = tasks.find((task) => task.kind === 'honors' && task.state === 'running') || null;
  const busy = runningTask ? (runningTask.stage === 'honor_polish' ? `polish-${runningTask.scope?.index ?? 'all'}` : runningTask.stage) : null;
  const busyRef = useRef(false);
  busyRef.current = !!busy;

  const updateListNote = (value) => {
    setListNote(value);
    setStored(LIST_NOTE_KEY, { text: value });
  };

  const runHonorTask = ({ label, stage, scope = {}, work }) => {
    if (findRunningTask((task) => task.kind === 'honors')) {
      toast.error('Atlas is still working on the honors list', { description: 'Wait for the running job to finish — its result will appear here.' });
      return null;
    }
    return startBackgroundTask({
      kind: 'honors', label, stage, scope: { honors: true, ...scope }, run: work,
    }).promise;
  };

  const guard = (action) => {
    if (hasLiveModel()) return true;
    toast.error(`${action} needs a connected AI model`, {
      description: 'Demo mode returns placeholder text, so Atlas will not rewrite your honors with it. Connect an AI provider in AI setup.',
      duration: 9000,
    });
    return false;
  };

  /** One entry's sharpening, run as a task; returns the proposal or null. */
  const polishOne = async ({ snapshot, index, context }) => {
    const entry = snapshot[index];
    if (!entry || !String(entry.name || '').trim()) return null;
    const outcome = await runAI({
      prompt: buildHonorPolishPrompt({
        honor: entry,
        index,
        honors: snapshot,
        profileText: context.profileText,
        // The shared list note is the same kind of ground truth as a row note.
        materialsText: [context.materialsText, String(listNote || '').trim()
          ? `THE APPLICANT'S NOTE FOR THE WHOLE LIST (facts first, like an entry's own note):\n${String(listNote).trim()}`
          : ''].filter(Boolean).join('\n\n'),
        applicantText: context.applicantText,
      }),
      response_json_schema: HONOR_POLISH_SCHEMA,
      temperature: 0.35,
    }, { fallbackTitle: 'Could not sharpen this honor', quiet: true });
    if (!isLiveOutcome(outcome)) return { index, entry, error: outcome?.error || new Error('The model did not return a usable answer.') };
    const cleaned = sanitizeHonorPolish(outcome.result, entry);
    return {
      index,
      before: entry,
      proposed: cleaned.honor,
      differs: honorPolishDiffers(entry, cleaned.honor),
      changes: cleaned.changes,
      missingFacts: cleaned.missingFacts,
      verdict: cleaned.verdict,
      truncations: cleaned.truncations,
    };
  };

  // Sharpening is triggered from the row itself; the work lives here so every
  // honors action shares one queue and one place where results are shown.
  const sharpenStarted = useRef(null);
  useEffect(() => {
    if (sharpenIndex == null || sharpenStarted.current === sharpenIndex || busyRef.current) return;
    sharpenStarted.current = sharpenIndex;
    let cancelled = false;
    (async () => {
      try {
        await handleSharpenOne(sharpenIndex);
      } finally {
        if (!cancelled) {
          sharpenStarted.current = null;
          onSharpenDone();
        }
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sharpenIndex]);

  const handleSharpenOne = async (index) => {
    if (!guard('Sharpening this honor')) return;
    if (busyRef.current) return;
    const snapshot = honors;
    const promise = runHonorTask({
      label: `Sharpening honor ${index + 1}`,
      stage: 'honor_polish',
      scope: { index },
      work: async () => {
        const context = await getContext();
        const item = await polishOne({ snapshot, index, context });
        if (!item) return null;
        if (item.error) {
          toast.error('No revision came back', { description: 'Your entry was left alone.' });
          return null;
        }
        if (!item.differs) {
          // An unchanged name is an honest answer, not a failure — and it is
          // never dressed up as a proposal the applicant has to dismiss.
          toast.message('This name already works', {
            description: item.verdict || 'Atlas found no wording change that its own facts support. The entry is untouched.',
          });
          return null;
        }
        memory.polish = { items: [item], from: index };
        return memory.polish;
      },
    });
    if (!promise) return;
    setPolish(null);
    try {
      const result = await promise;
      if (result) setPolish(result);
    } catch (e) {
      console.error(e);
      toast.error('Could not sharpen this honor', { description: e.message });
    }
  };

  const handleSharpenAll = async () => {
    if (!guard('Sharpening the list')) return;
    if (busyRef.current) return;
    const snapshot = honors;
    const targets = snapshot
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => String(item.name || '').trim())
      .map(({ index }) => index);
    if (!targets.length) {
      toast.error('There is nothing to sharpen yet', { description: 'A sharpen rewrites an existing honor name; it will not invent an honor.' });
      return;
    }
    const promise = runHonorTask({
      label: 'Sharpening the honors list',
      stage: 'honor_polish',
      scope: { index: 'all' },
      work: async ({ setStage }) => {
        const context = await getContext();
        const items = [];
        for (const [n, index] of targets.entries()) {
          setStage('honor_polish', { detail: `${n + 1} of ${targets.length}` });
          try {
            // eslint-disable-next-line no-await-in-loop
            const item = await polishOne({ snapshot, index, context });
            if (item && !item.error && item.differs) items.push(item);
          } catch (e) {
            // Keep going: one failed entry must not lose the others.
            console.error(e);
          }
        }
        memory.polish = { items, from: 'all', skipped: targets.length - items.filter((item) => item.differs).length };
        return memory.polish;
      },
    });
    if (!promise) return;
    setPolish(null);
    try {
      const result = await promise;
      if (result) {
        setPolish(result);
        if (!result.items.length) {
          toast.message('Nothing to change', { description: 'Every name already says what it proves within the field limit — or the model returned no usable answer. Your list is untouched.' });
        }
      }
    } catch (e) {
      console.error(e);
      toast.error('Could not sharpen the list', { description: e.message });
    }
  };

  const applyItem = (item) => {
    // The entry may have been edited or moved while the job ran: match it by
    // its text, and refuse to overwrite a different one.
    let index = sameHonorText(honors[item.index], item.before) ? item.index : -1;
    if (index < 0) index = honors.findIndex((entry) => sameHonorText(entry, item.before));
    if (index < 0) {
      toast.error('That honor has changed since Atlas read it', {
        description: 'Nothing was applied. Press Sharpen again on the current wording.',
      });
      setPolish((prev) => (prev ? { ...prev, items: prev.items.filter((entry) => entry !== item) } : prev));
      return;
    }
    const next = [...honors];
    // Only the name travels — grade and level are the applicant's facts.
    next[index] = { ...next[index], name: item.proposed.name };
    onChange(next);
    setPolish((prev) => {
      if (!prev) return prev;
      const items = prev.items.filter((entry) => entry !== item);
      return items.length ? { ...prev, items } : null;
    });
    toast.success('Honor updated', { description: 'Nothing is written to your profile until you press Save profile.' });
  };

  /**
   * Apply every still-valid proposal in one write. Going through `applyItem`
   * repeatedly would let each call rebuild the list from the same stale
   * snapshot and quietly undo the previous one, so the batch merges first and
   * calls `onChange` once. Proposals whose entry changed underneath are
   * reported and dropped, never forced.
   */
  const applyAll = () => {
    const items = (polish?.items || []).filter(Boolean);
    if (!items.length) return;
    let next = [...honors];
    const applied = [];
    const stale = [];
    for (const item of items) {
      let index = sameHonorText(honors[item.index], item.before) ? item.index : -1;
      if (index < 0) index = honors.findIndex((entry) => sameHonorText(entry, item.before));
      if (index < 0) { stale.push(item); continue; }
      next[index] = { ...next[index], name: item.proposed.name };
      applied.push(item);
    }
    if (applied.length) onChange(next);
    if (applied.length !== polish.items.length) {
      toast.warning(`${stale.length} proposal${stale.length === 1 ? '' : 's'} skipped`, {
        description: 'Those honors changed since Atlas read them. Nothing was overwritten; sharpen the current wording again if you still want it.',
      });
    }
    if (applied.length) toast.success(`${applied.length} honor${applied.length === 1 ? '' : 's'} updated`, { description: 'Nothing is written to your profile until you press Save profile.' });
    setPolish(applied.length === polish.items.length ? null : { ...polish, items: polish.items.filter((entry) => !applied.includes(entry)) });
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-accent/25 bg-accent/5 p-4 space-y-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-[220px]">
            <p className="text-sm font-medium flex items-center gap-1.5">
              <Sparkles className="w-4 h-4 text-accent" />
              Sharpen the wording — honors only
            </p>
            <p className="text-xs text-foreground/55 mt-1 leading-relaxed">
              Atlas rewrites a honor name so it carries the official title, the tier, and the real scale — from your note,
              your profile, and your materials only. It will not invent an honor, change your grade level, or touch the
              recognition level. Every change is a proposal you apply.
            </p>
          </div>
          <div className="text-[11px] text-foreground/40 shrink-0">
            Common App limits: name {HONOR_LIMITS.name} characters · up to {HONOR_LIMITS.maxHonors} honors
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={handleSharpenAll} disabled={busy !== null || !honors.some((h) => String(h?.name || '').trim())}>
            {busy === 'polish-all' ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5 mr-1.5" />}
            {busy === 'polish-all' ? 'Rewriting…' : `Sharpen the wording (${honors.filter((h) => String(h?.name || '').trim()).length})`}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setNoteOpen((open) => !open)} aria-expanded={noteOpen}>
            <KeyRound className="w-3.5 h-3.5 mr-1.5" />
            {noteOpen ? 'Hide list note' : 'Note for the whole list'}
          </Button>
          {!hasLiveModel() && (
            <span className="text-[11px] text-amber-700 self-center">
              Demo mode: connect a model in AI setup to use these.
            </span>
          )}
        </div>

        {noteOpen && (
          <div className="space-y-1.5">
            <label htmlFor="honor-list-note" className="text-xs font-medium text-foreground/70 flex items-center gap-1.5">
              <KeyRound className="w-3.5 h-3.5 text-accent" />
              Facts every sharpen may draw on — the pools, sponsors, tiers, and dates
            </label>
            <Textarea
              id="honor-list-note"
              value={listNote}
              onChange={(e) => updateListNote(e.target.value)}
              rows={3}
              placeholder={'e.g. JPhO silver = top 12 of ~2,400 registrants; the essay prize was 1 of 60; WSC “Outstanding Community Impact” was voted by 3,000 online voters…'}
              className="text-sm"
            />
            <p className="text-[11px] text-foreground/45 leading-relaxed">
              This box is never submitted. A per-honor note outranks it for that row; a shared note carries what repeats.
              Sharpen cites in its “reason” exactly which fact each added wording came from — if it cannot, it must not add it.
            </p>
          </div>
        )}
      </div>

      {polish?.items?.length > 0 && (
        <div className="rounded-xl border border-border bg-card p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h4 className="text-sm font-medium">
              Sharper wording for {polish.items.length} honor{polish.items.length === 1 ? '' : 's'}
              {polish.from === 'all' && polish.skipped ? <span className="text-foreground/40 font-normal"> · {polish.skipped} left as they were (already exact, or no safe change)</span> : null}
            </h4>
            <div className="flex items-center gap-2">
              {polish.items.length > 1 && (
                <Button size="sm" variant="outline" onClick={applyAll}>
                  <Check className="w-3.5 h-3.5 mr-1" /> Apply all
                </Button>
              )}
              <button onClick={() => setPolish(null)} className="text-foreground/30 hover:text-foreground transition" title="Discard these proposals">
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
          {polish.items.map((item) => (
            <div key={`${item.index}-${item.proposed.name}`} className="rounded-lg border border-border bg-muted/20 p-3 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <span className="text-[10px] uppercase tracking-wide text-foreground/40">Honor {item.index + 1}</span>
                <div className="flex items-center gap-1.5">
                  <Button size="sm" onClick={() => applyItem(item)}>
                    <Check className="w-3.5 h-3.5 mr-1" /> Apply
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setPolish((prev) => {
                    if (!prev) return prev;
                    const items = prev.items.filter((entry) => entry !== item);
                    return items.length ? { ...prev, items } : null;
                  })}>
                    Skip
                  </Button>
                </div>
              </div>
              <NameDiff before={item.before?.name || ''} after={item.proposed.name || ''} />
              <p className="text-[10px] text-foreground/30 text-right">
                {String(item.proposed.name || '').length}/{HONOR_LIMITS.name} characters
              </p>
              {item.verdict && (
                <p className="text-xs text-foreground/60 leading-relaxed">
                  <span className="font-medium">What this line now proves:</span> {item.verdict}
                </p>
              )}
              {item.changes?.length > 0 && (
                <ul className="space-y-1">
                  {item.changes.map((change, ci) => (
                    <li key={ci} className="text-[11px] text-foreground/50 leading-relaxed">
                      <span className="font-medium text-foreground/65">{change.field}:</span> {change.reason}
                    </li>
                  ))}
                </ul>
              )}
              {item.truncations?.length > 0 && (
                <p className="text-[11px] text-amber-700 flex items-start gap-1.5">
                  <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
                  The name ran past the Common App limit and was cut at a word boundary. Check the wording.
                </p>
              )}
              {item.missingFacts?.length > 0 && (
                <div>
                  <h5 className="text-[11px] font-medium text-amber-800 mb-1">Add these to the note box and sharpen again</h5>
                  <ul className="space-y-0.5">
                    {item.missingFacts.map((fact, fi) => (
                      <li key={fi} className="text-[11px] text-foreground/55 flex gap-2"><span className="text-accent">→</span>{fact}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ))}
          <p className="text-[11px] text-foreground/40">
            Applied wording is still not saved to your profile until you press Save profile — and removing a proposal here never changes your list.
          </p>
        </div>
      )}
    </div>
  );
}
