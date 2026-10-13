import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Sparkles, Loader2, Wand2, ListOrdered, Plus, X, Check, AlertTriangle,
  ScanSearch, CornerUpLeft, Quote,
} from 'lucide-react';
import { runAI } from '@/lib/ai';
import { hasLiveModel, isLiveOutcome } from '@/lib/aiOutcome';
import { diffText, diffStats } from '@/lib/textDiff';
import {
  ACTIVITY_LIMITS, ACTIVITY_SUGGEST_SCHEMA, ACTIVITY_POLISH_SCHEMA, ACTIVITY_LIST_SCHEMA,
  buildActivitySuggestPrompt, buildActivityPolishPrompt, buildActivityListReviewPrompt,
  sanitizeActivitySuggestion, isUsableSuggestion, activityFieldCounts,
} from '@/lib/activityPrompts';

const CONFIDENCE_TONE = {
  certain: 'bg-green-50 text-green-700 border-green-200',
  likely: 'bg-accent/10 text-accent border-accent/30',
  check: 'bg-amber-50 text-amber-800 border-amber-200',
};

const CONFIDENCE_LABEL = {
  certain: 'Stated plainly in your material',
  likely: 'Strongly implied — check the detail',
  check: 'Atlas had to infer this — confirm before using it',
};

function FieldLine({ label, value, limit }) {
  const length = String(value || '').length;
  const over = limit && length > limit;
  return (
    <div className="flex items-baseline gap-2 text-xs">
      <span className="text-foreground/35 w-20 shrink-0">{label}</span>
      <span className="flex-1 text-foreground/75 break-words">{value || <span className="text-foreground/25">empty</span>}</span>
      {limit ? (
        <span className={`shrink-0 font-mono text-[10px] ${over ? 'text-destructive' : 'text-foreground/30'}`}>
          {length}/{limit}
        </span>
      ) : null}
    </div>
  );
}

/** Description with the words the AI changed highlighted, same convention as the essay diff. */
function DescriptionDiff({ before, after }) {
  if (!before || before === after) {
    return <p className="text-xs text-foreground/75 leading-relaxed">{after}</p>;
  }
  const { ops } = diffText(before, after);
  const stats = diffStats(ops);
  return (
    <div>
      <p className="text-xs leading-relaxed whitespace-pre-wrap">
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
 * AI help for the Common App activities list.
 *
 * Everything here is a SUGGESTION. Atlas never writes to the list on its own:
 * each result is shown with the evidence behind it, the character count it
 * would take, and an explicit Add / Apply button. A suggestion that does not fit
 * the real Common App field limits is trimmed and says so, because a 170
 * character description would be silently cut by the application itself.
 *
 * @param {object} props
 * @param {Array} props.activities       current list
 * @param {Function} props.onChange      replaces the whole list
 * @param {Function} props.getContext    async () => { profileText, materialsText, applicantText }
 * @param {string} [props.universityName] named in the list review, which reads the list inside one application
 * @param {number|null} props.sharpenIndex  entry the applicant asked to sharpen
 * @param {Function} props.onSharpenDone called once that request has finished
 */
export default function ActivityAiPanel({
  activities = [], onChange, getContext, universityName = '',
  sharpenIndex = null, onSharpenDone = () => {},
}) {
  const [busy, setBusy] = useState(null);
  const [suggestions, setSuggestions] = useState(null);
  const [polish, setPolish] = useState(null);
  const [listReview, setListReview] = useState(null);

  const guard = (action) => {
    if (hasLiveModel()) return true;
    toast.error(`${action} needs a connected AI model`, {
      description: 'Demo mode returns placeholder text, so Atlas will not suggest anything for your activities list with it. Connect NaraRouter in AI setup.',
      duration: 9000,
    });
    return false;
  };

  // Sharpening is triggered from the entry itself in ActivitiesEditor; the work
  // happens here so every AI action for this section shares one queue and one
  // place where results are shown.
  const sharpenStarted = useRef(null);
  useEffect(() => {
    if (sharpenIndex == null || sharpenStarted.current === sharpenIndex) return;
    sharpenStarted.current = sharpenIndex;
    let cancelled = false;
    (async () => {
      try {
        await handlePolish(sharpenIndex);
      } finally {
        if (!cancelled) {
          sharpenStarted.current = null;
          onSharpenDone();
        }
      }
    })();
    return () => { cancelled = true; };
  }, [sharpenIndex]);

  const handleSuggest = async () => {
    if (!guard('Suggesting activities')) return;
    setBusy('suggest');
    setSuggestions(null);
    try {
      const context = await getContext();
      const outcome = await runAI({
        prompt: buildActivitySuggestPrompt({
          activities,
          profileText: context.profileText,
          materialsText: context.materialsText,
          applicantText: context.applicantText,
          slots: ACTIVITY_LIMITS.maxActivities,
        }),
        response_json_schema: ACTIVITY_SUGGEST_SCHEMA,
        temperature: 0.35,
      }, { fallbackTitle: 'Could not read your materials for activities', quiet: true });

      if (!isLiveOutcome(outcome)) {
        toast.error('No suggestions came back', { description: 'The model did not return a usable answer. Nothing was changed.' });
        return;
      }
      const raw = Array.isArray(outcome.result?.activities) ? outcome.result.activities : [];
      const cleaned = raw
        .map((item) => sanitizeActivitySuggestion(item))
        .filter(isUsableSuggestion);
      setSuggestions({
        items: cleaned,
        ordering: String(outcome.result?.ordering_rationale || ''),
        missingFacts: Array.isArray(outcome.result?.missing_facts) ? outcome.result.missing_facts : [],
        missingThemes: Array.isArray(outcome.result?.missing_themes) ? outcome.result.missing_themes : [],
        rawCount: raw.length,
      });
      if (!cleaned.length) {
        toast.warning('Nothing to suggest yet', {
          description: 'Atlas only suggests an activity it can point to in your own materials or profile. Add a resume, a certificate, or a note describing what you have done, then try again.',
          duration: 10000,
        });
      }
    } catch (e) {
      console.error(e);
      toast.error('Could not suggest activities', { description: e.message });
    } finally {
      setBusy(null);
    }
  };

  const handlePolish = async (index) => {
    if (!guard('Sharpening this entry')) return;
    setBusy(`polish-${index}`);
    setPolish(null);
    try {
      const context = await getContext();
      const outcome = await runAI({
        prompt: buildActivityPolishPrompt({
          activity: activities[index],
          index,
          activities,
          profileText: context.profileText,
          materialsText: context.materialsText,
          applicantText: context.applicantText,
          universityName,
        }),
        response_json_schema: ACTIVITY_POLISH_SCHEMA,
        temperature: 0.35,
      }, { fallbackTitle: 'Could not sharpen this entry', quiet: true });

      if (!isLiveOutcome(outcome)) {
        toast.error('No revision came back', { description: 'The model did not return a usable answer. Your entry was left alone.' });
        return;
      }
      const cleaned = sanitizeActivitySuggestion({ ...activities[index], ...outcome.result });
      setPolish({
        index,
        before: activities[index],
        proposed: cleaned.activity,
        changes: Array.isArray(outcome.result?.changes) ? outcome.result.changes : [],
        missingFacts: Array.isArray(outcome.result?.missing_facts) ? outcome.result.missing_facts : [],
        verdict: String(outcome.result?.verdict || ''),
        truncations: cleaned.truncations,
      });
    } catch (e) {
      console.error(e);
      toast.error('Could not sharpen this entry', { description: e.message });
    } finally {
      setBusy(null);
    }
  };

  const handleListReview = async () => {
    if (!guard('Reviewing the list')) return;
    if (!activities.length) {
      toast.error('There is no list to review yet', { description: 'Add an activity, or ask Atlas to suggest some from your materials.' });
      return;
    }
    setBusy('review');
    setListReview(null);
    try {
      const context = await getContext();
      const outcome = await runAI({
        prompt: buildActivityListReviewPrompt({
          activities,
          profileText: context.profileText,
          materialsText: context.materialsText,
          universityName,
        }),
        response_json_schema: ACTIVITY_LIST_SCHEMA,
        temperature: 0.25,
      }, { fallbackTitle: 'Could not review the list', quiet: true });

      if (!isLiveOutcome(outcome)) {
        toast.error('No review came back', { description: 'The model did not return a usable answer.' });
        return;
      }
      const ordering = (Array.isArray(outcome.result?.ordering) ? outcome.result.ordering : [])
        .map((n) => Number(n))
        .filter((n) => Number.isInteger(n) && n >= 1 && n <= activities.length);
      // A partial or duplicated ordering must never scramble the list, so it is
      // only used when it is a complete permutation of the current entries.
      const isPermutation = ordering.length === activities.length
        && new Set(ordering).size === activities.length;
      setListReview({
        ordering: isPermutation ? ordering : [],
        orderingInvalid: !isPermutation && ordering.length > 0,
        findings: Array.isArray(outcome.result?.findings) ? outcome.result.findings : [],
        redundant: Array.isArray(outcome.result?.redundant_pairs) ? outcome.result.redundant_pairs : [],
        missingThemes: Array.isArray(outcome.result?.missing_themes) ? outcome.result.missing_themes : [],
        fieldProblems: Array.isArray(outcome.result?.field_problems) ? outcome.result.field_problems : [],
        overall: String(outcome.result?.overall || ''),
      });
    } catch (e) {
      console.error(e);
      toast.error('Could not review the list', { description: e.message });
    } finally {
      setBusy(null);
    }
  };

  const addSuggestion = (suggestion) => {
    if (activities.length >= ACTIVITY_LIMITS.maxActivities) {
      toast.error(`The Common App allows ${ACTIVITY_LIMITS.maxActivities} activities`, {
        description: 'Remove or merge an entry before adding another. Which entries you keep is itself a decision the reader sees.',
      });
      return;
    }
    onChange([...activities, suggestion.activity]);
    setSuggestions((prev) => (prev ? { ...prev, items: prev.items.filter((item) => item !== suggestion) } : prev));
    toast.success('Added to your list', { description: 'It is not saved until you press Save profile. Check the hours, weeks, and grade levels — those are facts only you know.' });
  };

  const applyPolish = () => {
    if (!polish) return;
    const next = [...activities];
    next[polish.index] = { ...next[polish.index], ...polish.proposed };
    onChange(next);
    toast.success('Entry updated', { description: 'Nothing is written to your profile until you press Save profile.' });
    setPolish(null);
  };

  const applyOrdering = () => {
    if (!listReview?.ordering?.length) return;
    onChange(listReview.ordering.map((position) => activities[position - 1]).filter(Boolean));
    toast.success('List reordered', { description: 'The reader sees the first two or three entries properly, so this order is now your argument.' });
    setListReview((prev) => ({ ...prev, ordering: [], applied: true }));
  };

  const counts = (activity) => activityFieldCounts(activity);

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-accent/25 bg-accent/5 p-4 space-y-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-[220px]">
            <p className="text-sm font-medium flex items-center gap-1.5">
              <Sparkles className="w-4 h-4 text-accent" />
              AI help for this list
            </p>
            <p className="text-xs text-foreground/55 mt-1 leading-relaxed">
              Suggestions only. Atlas reads your profile and materials, proposes entries or sharper wording, and
              shows you the evidence — nothing is written to your list until you press Add or Apply.
            </p>
          </div>
          <div className="text-[11px] text-foreground/40 shrink-0">
            Common App limits: position {ACTIVITY_LIMITS.position} · organization {ACTIVITY_LIMITS.organization} · description {ACTIVITY_LIMITS.description} characters
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={handleSuggest} disabled={busy !== null}>
            {busy === 'suggest' ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <ScanSearch className="w-3.5 h-3.5 mr-1.5" />}
            {busy === 'suggest' ? 'Reading your materials…' : 'Suggest activities from my materials'}
          </Button>
          <Button size="sm" variant="outline" onClick={handleListReview} disabled={busy !== null || !activities.length}>
            {busy === 'review' ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <ListOrdered className="w-3.5 h-3.5 mr-1.5" />}
            {busy === 'review' ? 'Reading the list…' : 'Review order and impact'}
          </Button>
          {!hasLiveModel() && (
            <span className="text-[11px] text-amber-700 self-center">
              Demo mode: connect a model in AI setup to use these.
            </span>
          )}
        </div>
      </div>

      {suggestions && (
        <div className="rounded-xl border border-border bg-card p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h4 className="text-sm font-medium">
              Suggested entries ({suggestions.items.length})
            </h4>
            <button onClick={() => setSuggestions(null)} className="text-foreground/30 hover:text-foreground transition">
              <X className="w-4 h-4" />
            </button>
          </div>
          {suggestions.rawCount > suggestions.items.length && (
            <p className="text-[11px] text-foreground/40">
              {suggestions.rawCount - suggestions.items.length} suggestion(s) were dropped because they had no
              usable text in them.
            </p>
          )}
          {suggestions.items.length === 0 && (
            <p className="text-xs text-foreground/50 leading-relaxed">
              Atlas found nothing in your materials it could point to. Add a resume, a certificate, a programme
              description, or a note about what you have done outside class — then this will have something to work
              from. Atlas will not invent an activity for you.
            </p>
          )}
          {suggestions.items.map((suggestion, index) => {
            const c = counts(suggestion.activity);
            return (
              <div key={index} className="rounded-lg border border-border bg-muted/20 p-3 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <span className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-medium ${CONFIDENCE_TONE[suggestion.confidence] || CONFIDENCE_TONE.check}`}>
                      {CONFIDENCE_LABEL[suggestion.confidence] || CONFIDENCE_LABEL.check}
                    </span>
                    {suggestion.activity.activity_type && (
                      <Badge variant="outline" className="ml-1.5 text-[10px] font-normal">{suggestion.activity.activity_type}</Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Button size="sm" onClick={() => addSuggestion(suggestion)} disabled={activities.length >= ACTIVITY_LIMITS.maxActivities}>
                      <Plus className="w-3.5 h-3.5 mr-1" /> Add
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setSuggestions((prev) => (prev ? { ...prev, items: prev.items.filter((_, i) => i !== index) } : prev))}
                    >
                      Skip
                    </Button>
                  </div>
                </div>
                <div className="space-y-1">
                  <FieldLine label="Position" value={suggestion.activity.position} limit={ACTIVITY_LIMITS.position} />
                  <FieldLine label="Organization" value={suggestion.activity.organization} limit={ACTIVITY_LIMITS.organization} />
                  <div className="flex items-baseline gap-2 text-xs">
                    <span className="text-foreground/35 w-20 shrink-0">Description</span>
                    <span className="flex-1 text-foreground/75 break-words">{suggestion.activity.description}</span>
                    <span className="shrink-0 font-mono text-[10px] text-foreground/30">{c.description}/{ACTIVITY_LIMITS.description}</span>
                  </div>
                  {(suggestion.activity.timing || suggestion.activity.hours_per_week != null || suggestion.activity.weeks_per_year != null || suggestion.activity.grade_levels?.length > 0) && (
                    <p className="text-[11px] text-foreground/40 pl-[5.5rem]">
                      {[
                        suggestion.activity.grade_levels?.length ? `grades ${suggestion.activity.grade_levels.join(', ')}` : '',
                        suggestion.activity.timing || '',
                        suggestion.activity.hours_per_week != null ? `${suggestion.activity.hours_per_week} hrs/week` : '',
                        suggestion.activity.weeks_per_year != null ? `${suggestion.activity.weeks_per_year} weeks/year` : '',
                      ].filter(Boolean).join(' · ') || 'no structured fields suggested'}
                    </p>
                  )}
                </div>
                {suggestion.truncations?.length > 0 && (
                  <p className="text-[11px] text-amber-700 flex items-start gap-1.5">
                    <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
                    {suggestion.truncations.join(', ')} ran past the Common App limit and was cut at a word boundary. Check the wording.
                  </p>
                )}
                {suggestion.evidence && (
                  <p className="text-[11px] text-foreground/50 flex items-start gap-1.5 leading-relaxed">
                    <Quote className="w-3 h-3 mt-0.5 shrink-0" />
                    <span><span className="font-medium">Evidence:</span> {suggestion.evidence}</span>
                  </p>
                )}
                {suggestion.why_it_matters && (
                  <p className="text-[11px] text-foreground/50 leading-relaxed">
                    <span className="font-medium">Why it earns a slot:</span> {suggestion.why_it_matters}
                  </p>
                )}
              </div>
            );
          })}
          {suggestions.ordering && (
            <div className="rounded-lg border border-border p-3">
              <h5 className="text-xs font-medium text-foreground/60 mb-1">How Atlas would order the finished list</h5>
              <p className="text-xs text-foreground/55 leading-relaxed">{suggestions.ordering}</p>
            </div>
          )}
          {suggestions.missingFacts?.length > 0 && (
            <div>
              <h5 className="text-xs font-medium text-amber-800 mb-1">Confirm or add these facts</h5>
              <ul className="space-y-1">
                {suggestions.missingFacts.map((item, index) => (
                  <li key={index} className="text-[11px] text-foreground/55 flex gap-2">
                    <span className="text-accent">→</span>{item}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {suggestions.missingThemes?.length > 0 && (
            <div>
              <h5 className="text-xs font-medium text-foreground/60 mb-1">What the list still does not show</h5>
              <ul className="space-y-1">
                {suggestions.missingThemes.map((item, index) => (
                  <li key={index} className="text-[11px] text-foreground/55 flex gap-2">
                    <span className="text-accent">→</span>{item}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {polish && (
        <div className="rounded-xl border border-border bg-card p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h4 className="text-sm font-medium">Sharper wording for entry {polish.index + 1}</h4>
            <button onClick={() => setPolish(null)} className="text-foreground/30 hover:text-foreground transition">
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="space-y-2 rounded-lg border border-border bg-muted/20 p-3">
            <div>
              <span className="text-[10px] uppercase tracking-wide text-foreground/35">Position</span>
              <DescriptionDiff before={polish.before.position || ''} after={polish.proposed.position || ''} />
            </div>
            <div>
              <span className="text-[10px] uppercase tracking-wide text-foreground/35">Organization</span>
              <DescriptionDiff before={polish.before.organization || ''} after={polish.proposed.organization || ''} />
            </div>
            <div>
              <span className="text-[10px] uppercase tracking-wide text-foreground/35">Description</span>
              <DescriptionDiff before={polish.before.description || ''} after={polish.proposed.description || ''} />
              <p className="text-[10px] text-foreground/30 mt-1 text-right">
                {String(polish.proposed.description || '').length}/{ACTIVITY_LIMITS.description} characters
              </p>
            </div>
          </div>

          {polish.verdict && (
            <p className="text-xs text-foreground/60 leading-relaxed">
              <span className="font-medium">What this entry now proves:</span> {polish.verdict}
            </p>
          )}
          {polish.changes?.length > 0 && (
            <ul className="space-y-1">
              {polish.changes.map((change, index) => (
                <li key={index} className="text-[11px] text-foreground/50 leading-relaxed">
                  <span className="font-medium text-foreground/65">{change.field}:</span> {change.reason}
                </li>
              ))}
            </ul>
          )}
          {polish.truncations?.length > 0 && (
            <p className="text-[11px] text-amber-700 flex items-start gap-1.5">
              <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
              {polish.truncations.join(', ')} ran past the Common App limit and was cut at a word boundary.
            </p>
          )}
          {polish.missingFacts?.length > 0 && (
            <div>
              <h5 className="text-xs font-medium text-amber-800 mb-1">The number that would make this land</h5>
              <ul className="space-y-1">
                {polish.missingFacts.map((item, index) => (
                  <li key={index} className="text-[11px] text-foreground/55 flex gap-2">
                    <span className="text-accent">→</span>{item}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex items-center gap-2 pt-1">
            <Button size="sm" onClick={applyPolish}>
              <Check className="w-3.5 h-3.5 mr-1.5" /> Apply this wording
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setPolish(null)}>
              <CornerUpLeft className="w-3.5 h-3.5 mr-1.5" /> Keep mine
            </Button>
          </div>
        </div>
      )}

      {listReview && (
        <div className="rounded-xl border border-border bg-card p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h4 className="text-sm font-medium">How this list reads</h4>
            <button onClick={() => setListReview(null)} className="text-foreground/30 hover:text-foreground transition">
              <X className="w-4 h-4" />
            </button>
          </div>

          {listReview.overall && (
            <p className="text-sm text-foreground/65 leading-relaxed">{listReview.overall}</p>
          )}

          {listReview.ordering?.length > 0 && (
            <div className="rounded-lg border border-border bg-muted/20 p-3">
              <h5 className="text-xs font-medium text-foreground/60 mb-2">Recommended order</h5>
              <ol className="space-y-1">
                {listReview.ordering.map((position, index) => (
                  <li key={index} className="text-xs text-foreground/60 flex gap-2">
                    <span className="font-mono text-foreground/35 w-4">{index + 1}.</span>
                    <span className={position === index + 1 ? '' : 'font-medium'}>
                      {activities[position - 1]?.position || activities[position - 1]?.organization || `entry ${position}`}
                      {activities[position - 1]?.organization && activities[position - 1]?.position ? `, ${activities[position - 1].organization}` : ''}
                      {position !== index + 1 && <span className="text-accent"> (currently #{position})</span>}
                    </span>
                  </li>
                ))}
              </ol>
              <Button size="sm" variant="outline" className="mt-2.5" onClick={applyOrdering}>
                <ListOrdered className="w-3.5 h-3.5 mr-1.5" /> Reorder my list
              </Button>
            </div>
          )}
          {listReview.orderingInvalid && (
            <p className="text-[11px] text-amber-700">
              The suggested order did not name every entry exactly once, so Atlas will not reorder your list on it.
              The findings below still apply.
            </p>
          )}
          {listReview.applied && !listReview.ordering?.length && (
            <p className="text-[11px] text-green-700">Order applied. Press Save profile to keep it.</p>
          )}

          {listReview.findings?.length > 0 && (
            <ul className="space-y-2">
              {listReview.findings.map((finding, index) => (
                <li key={index} className="rounded-lg border border-border p-2.5">
                  <p className="text-xs text-foreground/70">
                    <span className="font-medium">Entry {finding.entry}:</span> {finding.issue}
                  </p>
                  {finding.fix && (
                    <p className="text-xs text-foreground/55 mt-1 flex gap-1.5">
                      <Wand2 className="w-3 h-3 mt-0.5 shrink-0 text-accent" />{finding.fix}
                    </p>
                  )}
                  {finding.severity === 'high' && (
                    <Badge variant="outline" className="mt-1.5 text-[10px] border-red-200 text-red-700">high</Badge>
                  )}
                </li>
              ))}
            </ul>
          )}

          {listReview.fieldProblems?.length > 0 && (
            <div>
              <h5 className="text-xs font-medium text-red-700 mb-1">Field problems</h5>
              <ul className="space-y-1">
                {listReview.fieldProblems.map((item, index) => (
                  <li key={index} className="text-[11px] text-foreground/55 flex gap-2">
                    <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0 text-red-500" />{item}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {listReview.redundant?.length > 0 && (
            <div>
              <h5 className="text-xs font-medium text-foreground/60 mb-1">Entries that overlap</h5>
              <ul className="space-y-1">
                {listReview.redundant.map((item, index) => (
                  <li key={index} className="text-[11px] text-foreground/55 flex gap-2">
                    <span className="text-accent">→</span>{item}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {listReview.missingThemes?.length > 0 && (
            <div>
              <h5 className="text-xs font-medium text-foreground/60 mb-1">What the list does not show yet</h5>
              <ul className="space-y-1">
                {listReview.missingThemes.map((item, index) => (
                  <li key={index} className="text-[11px] text-foreground/55 flex gap-2">
                    <span className="text-accent">→</span>{item}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {busy && (
        <p className="text-[11px] text-foreground/40 flex items-center gap-1.5">
          <Loader2 className="w-3 h-3 animate-spin" />
          Working. AI requests run one at a time through a shared queue, so other AI actions wait until this finishes.
        </p>
      )}

    </div>
  );
}
