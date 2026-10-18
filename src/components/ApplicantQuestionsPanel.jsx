import { useCallback, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import {
  MessageCircleQuestion, Loader2, Send, Trash2, X, Sparkles, TriangleAlert,
  Check, RotateCcw, Star,
} from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { runAI } from '@/lib/ai';
import { hasLiveModel, isLiveOutcome } from '@/lib/aiOutcome';
import { startBackgroundTask, findRunningTask } from '@/lib/backgroundTasks';
import { useBackgroundTasks } from '@/hooks/use-background-tasks';
import { applicantKnowledgeForPrompt } from '@/lib/applicantKnowledge';
import {
  QA_FEEDS, QA_ASK_LIMIT, loadQaEntries, saveQaEntries, mergeQuestions, patchQaEntry, removeQaEntry,
  openQuestions, pendingAnalysis, buildQaQuestionsPrompt, normalizeQuestions, buildQaAnswerPrompt,
  normalizeQaAnalysis, qaAnswerRow, qaAnalysisRows, QA_QUESTIONS_SCHEMA, QA_ANSWER_SCHEMA,
} from '@/lib/applicantQA';

/**
 * The interview panel: Atlas asks, the applicant answers, and every answer is
 * filed into the knowledge base — never as an obligation.
 *
 * Design rules:
 *  - questions come from the real gaps in the file, not a generic questionnaire;
 *  - the answer itself becomes an item the applicant wrote (no model needed);
 *  - a model pass then reads between the lines and files insights + facts;
 *  - stored information is REFERENCE unless the applicant marks it "must
 *    include", in which case every prompt that reads it is told it is an
 *    instruction (see `qaNote` in applicantKnowledge.js).
 */
export default function ApplicantQuestionsPanel({ inputs, rows = [], materials = [], tableMissing = false, onRowsChanged = () => {} }) {
  const [entries, setEntries] = useState(() => loadQaEntries());
  const [drafts, setDrafts] = useState({});
  const [includeFlags, setIncludeFlags] = useState({});
  const [busyAction, setBusyAction] = useState(null);
  const storeRef = useRef(entries);
  storeRef.current = entries;

  const update = useCallback((next) => {
    setEntries(saveQaEntries(next));
  }, []);

  const onTaskChange = useCallback((task) => {
    if (task.kind !== 'qa' || task.state === 'running') return;
    setEntries(loadQaEntries());
    if (task.state === 'done') onRowsChanged();
  }, [onRowsChanged]);
  const tasks = useBackgroundTasks(onTaskChange);
  const running = tasks.find((task) => task.kind === 'qa' && task.state === 'running') || null;
  const busy = !!running;

  const qaTask = ({ label, stage, run }) => {
    if (findRunningTask((task) => task.kind === 'qa')) {
      toast.error('Atlas is still working on the questions', { description: 'Wait for the running job to finish.' });
      return null;
    }
    return startBackgroundTask({ kind: 'qa', label, stage, scope: { qa: true }, run }).promise;
  };

  // --------------------------------------------------------------------------
  // Ask
  // --------------------------------------------------------------------------
  const handleAsk = async () => {
    if (!hasLiveModel()) {
      toast.error('Asking needs a connected AI model', { description: 'Demo mode cannot decide what to ask. Connect a provider in AI setup.' });
      return;
    }
    if (tableMissing) {
      toast.error('The knowledge table is missing', { description: 'Run supabase/schema.sql once — answers are filed into the knowledge base, which lives there.' });
      return;
    }
    const context = {
      profileText: inputs?.profileText || '',
      // The model sees the portrait exactly as drafters do, so it asks only
      // about what the knowledge base genuinely lacks.
      knowledgeText: rows.length ? applicantKnowledgeForPrompt(rows, { maxChars: 12000 }) : '',
      materialsNote: (materials || []).length
        ? `Materials on file: ${materials.map((m) => m.title || 'Untitled').join('; ')}`
        : '(no materials yet — the profile and any drafts are all there is)',
      limit: QA_ASK_LIMIT,
    };
    setBusyAction('ask');
    const promise = qaTask({
      label: 'Deciding what to ask you',
      stage: 'ask',
      run: async () => {
        const outcome = await runAI({
          prompt: buildQaQuestionsPrompt(context),
          response_json_schema: QA_QUESTIONS_SCHEMA,
          temperature: 0.4,
        }, { fallbackTitle: 'Could not prepare questions', quiet: true });
        if (!isLiveOutcome(outcome)) {
          toast.error('No questions came back', { description: 'The model did not return a usable answer. Nothing was changed.' });
          return null;
        }
        const questions = normalizeQuestions(outcome.result || {});
        // Persisted into the browser store before the task resolves: the result
        // must outlive this page.
        const next = mergeQuestions(loadQaEntries(), questions);
        saveQaEntries(next.entries);
        return next;
      },
    });
    if (!promise) { setBusyAction(null); return; }
    try {
      const result = await promise;
      if (result) {
        if (result.added) toast.success(`${result.added} question${result.added === 1 ? '' : 's'} waiting for you`, { description: 'Answer the ones that matter; dismiss the rest — Atlas will not ask them again.' });
        else toast.message('Nothing worth asking right now', { description: 'Your answers so far cover the gaps Atlas could find. Ask again after you add materials or edit a draft.' });
      }
    } catch (e) {
      console.error(e);
      toast.error('Could not prepare questions', { description: e.message });
    } finally {
      setBusyAction(null);
    }
  };

  // --------------------------------------------------------------------------
  // Answer (+ the read-between-the-lines pass)
  // --------------------------------------------------------------------------
  const analysisTask = (justAnswered = null) => qaTask({
    label: 'Reading between the lines of your answers',
    stage: 'analyze',
    run: async ({ setStage }) => {
      const knowledgeText = rows.length ? applicantKnowledgeForPrompt(rows, { maxChars: 9000 }) : '';
      const targets = justAnswered
        ? loadQaEntries().filter((entry) => entry.id === justAnswered)
        : pendingAnalysis(loadQaEntries());
      let done = 0;
      let failed = 0;
      for (const entry of targets) {
        if (!entry.answer.trim()) continue;
        setStage('analyze', { detail: entry.question.slice(0, 60) });
        // Rows created before a mid-way failure still belong to this exchange:
        // keeping their ids lets "Delete this exchange" clean them up.
        const created = [];
        try {
          const outcome = await runAI({
            prompt: buildQaAnswerPrompt({ entry, profileText: inputs?.profileText || '', knowledgeText }),
            response_json_schema: QA_ANSWER_SCHEMA,
            temperature: 0.25,
          }, { fallbackTitle: 'Could not read this answer', quiet: true });
          if (!isLiveOutcome(outcome)) throw new Error('no usable answer');
          const analysis = normalizeQaAnalysis(outcome.result || {});
          const rowsToAdd = qaAnalysisRows(entry, analysis);
          for (const row of rowsToAdd) {
            // eslint-disable-next-line no-await-in-loop
            const savedRow = await base44.entities.ApplicantKnowledge.create(row);
            if (savedRow?.id) created.push(savedRow.id);
          }
          const savedNow = loadQaEntries();
          const prior = savedNow.find((item) => item.id === entry.id);
          saveQaEntries(patchQaEntry(savedNow, entry.id, {
            row_ids: [...(prior?.row_ids || []), ...created],
            analysis: {
              status: 'done',
              insights: analysis.insights.length,
              facts: analysis.facts.length,
              note: analysis.note,
              at: new Date().toISOString(),
            },
          }));
          done += 1;
        } catch (e) {
          console.error(e);
          const savedNow = loadQaEntries();
          const prior = savedNow.find((item) => item.id === entry.id);
          saveQaEntries(patchQaEntry(savedNow, entry.id, {
            row_ids: [...(prior?.row_ids || []), ...created],
            analysis: {
              ...(prior?.analysis || {}),
              status: 'failed',
              note: created.length
                ? `The reading pass stopped partway; ${created.length} row${created.length === 1 ? '' : 's'} it had already written stay attached to this answer. Your answer itself is filed as a personal point.`
                : 'The analysis pass did not complete; your answer is still filed as a personal point.',
            },
          }));
          failed += 1;
        }
      }
      return { done, failed };
    },
  });

  const handleAnswer = async (entry) => {
    const answer = String(drafts[entry.id] || '').trim();
    if (answer.length < 2) {
      toast.error('Type an answer first', { description: 'Even two rough sentences beat leaving it blank — Atlas works from your words, not its guesses.' });
      return;
    }
    if (tableMissing) {
      toast.error('The knowledge table is missing', { description: 'Answers are filed into the knowledge base. Run supabase/schema.sql first.' });
      return;
    }
    setBusyAction(`answer-${entry.id}`);
    try {
      // 1. The answer itself, filed immediately as the applicant's own item.
      //    On a re-answer the previous rows are replaced — but only after the
      //    new row exists, so a failed write can never leave the exchange with
      //    less than it started with.
      const row = qaAnswerRow({ ...entry, answer, include: includeFlags[entry.id] ?? entry.include });
      const savedRow = await base44.entities.ApplicantKnowledge.create(row);
      if (!savedRow?.id) throw new Error('Atlas could not confirm the answer was saved. Nothing else changed; try again.');
      for (const id of entry.row_ids || []) {
        // eslint-disable-next-line no-await-in-loop
        await base44.entities.ApplicantKnowledge.delete(id).catch(() => {});
      }
      const next = patchQaEntry(storeRef.current, entry.id, {
        status: 'answered',
        answer,
        include: includeFlags[entry.id] ?? entry.include,
        answered_at: new Date().toISOString(),
        row_ids: [savedRow.id],
        // A re-answer re-runs the reading pass even if the old one finished.
        analysis: { status: 'pending', note: '' },
      });
      update(next);
      onRowsChanged();
      // 2. The between-the-lines reading, as a background task when a model
      //    is connected. Without one the answer still stands on its own.
      if (hasLiveModel()) {
        const promise = analysisTask(entry.id);
        if (promise) {
          const outcome = await promise.catch(() => null);
          if (outcome && outcome.failed) toast.warning('Answer filed; the deeper reading did not finish', { description: 'Your answer is in Personal points. Press “Read my pending answers” to try the interpretation again.' });
        }
      } else {
        update(patchQaEntry(next, entry.id, { analysis: { status: 'deferred', note: 'Connect a model to run the between-the-lines reading; your answer is filed as it stands.' } }));
      }
      setDrafts((prev) => { const n = { ...prev }; delete n[entry.id]; return n; });
      toast.success('Answer filed into your knowledge base', { description: 'It reads as reference, not an obligation — unless you marked it must-include. Edit or remove it in the panels below at any time.' });
    } catch (e) {
      console.error(e);
      toast.error('Could not save your answer', { description: e.message });
    } finally {
      setBusyAction(null);
    }
  };

  const handleAnalyzePending = async () => {
    if (!hasLiveModel()) {
      toast.error('This needs a connected AI model', { description: 'Demo mode never files placeholder text into your knowledge base.' });
      return;
    }
    const promise = analysisTask();
    if (!promise) return;
    try {
      const outcome = await promise;
      if (outcome?.done) toast.success(`Read ${outcome.done} answer${outcome.done === 1 ? '' : 's'} more deeply`, { description: 'Insights went to About you, facts to Personal points — all editable.' });
      else toast.message('Nothing pending', { description: 'Every filed answer has already been read.' });
    } catch (e) {
      console.error(e);
      toast.error('The reading pass failed', { description: e.message });
    }
    onRowsChanged();
  };

  const handleDismiss = (entry) => update(patchQaEntry(storeRef.current, entry.id, { status: 'dismissed' }));

  const handleReanswer = (entry) => {
    setDrafts((prev) => ({ ...prev, [entry.id]: entry.answer }));
    setIncludeFlags((prev) => ({ ...prev, [entry.id]: entry.include }));
    update(patchQaEntry(storeRef.current, entry.id, { status: 'open' }));
  };

  const handleRemoveExchange = async (entry) => {
    const ids = entry.row_ids || [];
    if (ids.length && !window.confirm('Remove this exchange? The knowledge items filed from your answer will be deleted with it, and Atlas will forget them.')) return;
    try {
      for (const id of ids) {
        // eslint-disable-next-line no-await-in-loop
        await base44.entities.ApplicantKnowledge.delete(id).catch(() => {});
      }
      update(removeQaEntry(storeRef.current, entry.id));
      onRowsChanged();
      toast.success('Exchange removed', { description: ids.length ? `${ids.length} knowledge item${ids.length === 1 ? '' : 's'} deleted with it.` : 'The answer was not filed, so nothing else changed.' });
    } catch (e) {
      toast.error('Could not remove this exchange', { description: e.message });
    }
  };

  const filedSummary = (entry) => {
    const a = entry.analysis;
    const extra = a?.status === 'done' && ((a.insights || 0) + (a.facts || 0)) > 0
      ? ` + ${a.insights || 0} portrait reading${a.facts ? ` · ${a.facts} extra fact${a.facts === 1 ? '' : 's'}` : ''}` : '';
    if (a?.status === 'done') return `Filed 1 personal point${extra}.${a.note ? ` ${a.note}` : ''}`;
    if (a?.status === 'deferred' || a?.status === 'failed') return `Filed 1 personal point. ${a.note}`;
    return 'Filed 1 personal point — the deeper reading is queued.';
  };
  const open = openQuestions(entries);
  const answered = entries.filter((entry) => entry.status === 'answered');
  const [showAnswered, setShowAnswered] = useState(false);
  const dismissedCount = entries.filter((entry) => entry.status === 'dismissed').length;
  const anyPending = pendingAnalysis(entries).length > 0;

  return (
    <section className="rounded-xl border border-accent/25 bg-accent/5 overflow-hidden">
      <div className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-[240px]">
            <h2 className="font-display text-lg font-semibold flex items-center gap-2">
              <MessageCircleQuestion className="w-5 h-5 text-accent" />
              Questions Atlas can ask you
            </h2>
            <p className="text-xs text-foreground/55 mt-1 leading-relaxed max-w-2xl">
              The file only knows what you have written. Atlas finds the gaps that make writing land — the number, the role, the
              reason behind it — and asks. Your answer goes into the knowledge base as an item <span className="font-medium">you</span> wrote,
              plus a between-the-lines reading. It is reference for every drafter, never an obligation: only the answers you mark
              <span className="font-medium"> must-include</span> are treated as instructions.
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap justify-end">
            <Button size="sm" onClick={handleAsk} disabled={busy}>
              {busy && busyAction === 'ask' ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5 mr-1.5" />}
              {busy && busyAction === 'ask' ? 'Choosing questions…' : open.length ? 'Ask me more' : 'Ask me questions'}
            </Button>
            {anyPending && (
              <Button size="sm" variant="outline" onClick={handleAnalyzePending} disabled={busy}>
                {busy ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5 mr-1.5" />}
                Read my pending answers
              </Button>
            )}
          </div>
        </div>

        {tableMissing && (
          <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2 flex items-start gap-1.5">
            <TriangleAlert className="w-3.5 h-3.5 mt-px shrink-0" />
            Answers are filed into the knowledge base, so this section needs the table. Run <span className="font-mono">supabase/schema.sql</span> once.
          </p>
        )}
        {!hasLiveModel() && !tableMissing && (
          <p className="text-[11px] text-foreground/50">
            No live model: questions cannot be generated, but you can still <span className="font-medium">paste an answer below a question you already have</span> —
            it files as your own item, and the deeper reading runs the moment a model is connected.
          </p>
        )}

        {open.length === 0 && (
          <p className="text-sm text-foreground/45 border border-dashed border-accent/25 rounded-xl p-3">
            No open question. {dismissedCount ? `${dismissedCount} dismissed earlier. ` : ''}Press “Ask me questions” after adding materials or editing a draft — the gaps shift as the file grows.
          </p>
        )}

        {open.map((entry) => (
          <div key={entry.id} className="rounded-xl border border-border bg-card p-3 space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-medium leading-snug">{entry.question}</p>
                {entry.why && <p className="text-[11px] text-foreground/50 mt-0.5 leading-relaxed">{entry.why}</p>}
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <Badge variant="outline" className="h-5 px-1.5 text-[10px]">{QA_FEEDS[entry.feeds] || 'Context'}</Badge>
                <button onClick={() => handleDismiss(entry)} className="p-1 rounded text-foreground/30 hover:text-foreground hover:bg-muted" title="Not worth answering — Atlas will stop asking this">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
            <Textarea
              value={drafts[entry.id] ?? entry.answer ?? ''}
              onChange={(e) => setDrafts((prev) => ({ ...prev, [entry.id]: e.target.value }))}
              rows={2}
              placeholder={'Your answer, in your own words — numbers, names, how you actually felt. Shorthand is fine.'}
              className="text-sm"
            />
            <div className="flex items-center gap-3 flex-wrap">
              <label className="inline-flex items-center gap-2 cursor-pointer select-none" title="Turn this answer from reference into an instruction: every drafting and review prompt is told to honour it.">
                <Switch
                  checked={includeFlags[entry.id] ?? entry.include ?? false}
                  onCheckedChange={(v) => setIncludeFlags((prev) => ({ ...prev, [entry.id]: v }))}
                  disabled={busy}
                />
                <span className="text-[11px] text-foreground/60 inline-flex items-center gap-1"><Star className="w-3 h-3" /> Must include — this one is an instruction</span>
              </label>
              <Button size="sm" className="ml-auto" onClick={() => handleAnswer(entry)} disabled={busy || tableMissing || busyAction === `answer-${entry.id}`}>
                {busyAction === `answer-${entry.id}` ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Send className="w-3.5 h-3.5 mr-1.5" />}
                File my answer
              </Button>
            </div>
          </div>
        ))}

        {answered.length > 0 && (
          <div className="pt-1">
            <button onClick={() => setShowAnswered((v) => !v)} className="text-xs text-foreground/50 hover:text-foreground inline-flex items-center gap-1.5" aria-expanded={showAnswered}>
              <Check className="w-3.5 h-3.5 text-emerald-600" />
              {answered.length} answered exchange{answered.length === 1 ? '' : 's'} {showAnswered ? '(hide)' : '(show)'}
            </button>
            {showAnswered && (
              <ul className="mt-2 space-y-2">
                {answered.map((entry) => (
                  <li key={entry.id} className="rounded-lg border border-border bg-card p-3 text-xs space-y-1.5">
                    <p className="font-medium text-foreground/70 leading-snug">{entry.question}</p>
                    <p className="text-foreground/60 leading-relaxed whitespace-pre-wrap">{entry.answer}</p>
                    <div className="flex items-center gap-2 flex-wrap text-[10px] text-foreground/45">
                      {entry.include && <Badge variant="outline" className="h-4 px-1 text-[9px] text-accent border-accent/30 gap-1"><Star className="w-2.5 h-2.5" /> must include</Badge>}
                      <span>{filedSummary(entry)}</span>
                      <span className="ml-auto flex items-center gap-1">
                        <button onClick={() => handleReanswer(entry)} className="p-1 rounded text-foreground/30 hover:text-foreground hover:bg-muted" title="Edit the answer — the filed items are rebuilt from the new text">
                          <RotateCcw className="w-3 h-3" />
                        </button>
                        <button onClick={() => handleRemoveExchange(entry)} className="p-1 rounded text-foreground/30 hover:text-destructive hover:bg-destructive/5" title="Remove the exchange and the items filed from it">
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
