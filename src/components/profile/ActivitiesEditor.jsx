import { Plus, Trash2, Wand2, Scissors } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  ACTIVITY_TYPES, TIMING_OPTIONS, GRADE_LEVELS, ACTIVITY_LIMITS,
  HOURS_PER_WEEK_MAX, WEEKS_PER_YEAR_MAX, fitActivityField,
} from '@/lib/activityPrompts';

const MAX_ACTIVITIES = ACTIVITY_LIMITS.maxActivities;
const DESC_LIMIT = ACTIVITY_LIMITS.description;
const POSITION_LIMIT = ACTIVITY_LIMITS.position;
const ORG_LIMIT = ACTIVITY_LIMITS.organization;

// Hours and weeks are typed into number inputs. Only a finite, non-negative
// number is kept, capped at what a week or a year can hold, so "-5" or "1e3"
// cannot be saved.
const cleanAmount = (raw, max, whole = false) => {
  if (raw === '' || raw == null) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.min(whole ? Math.trunc(n) : n, max);
};

/**
 * One capped text field with its live counter.
 *
 * The limit is not enforced with `maxLength`/`.slice()`: that silently destroys
 * a pasted description and the applicant never learns the text was cut. Instead
 * the field accepts everything, turns red past the limit, and offers an explicit
 * Trim that cuts at a word boundary — the same cut the Common App would make,
 * only made on purpose and visible.
 */
function CappedField({ label, value, limit, onChange, onTrim, placeholder, hint, multiline = false, rows = 2 }) {
  const text = String(value || '');
  const over = text.length > limit;
  const shared = {
    value: text,
    onChange: (e) => onChange(e.target.value),
    placeholder,
  };
  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between gap-2 mb-1">
        <label className="text-xs font-medium text-foreground/50 truncate">{label}</label>
        <span className={`text-[11px] font-mono shrink-0 ${over ? 'text-destructive font-semibold' : 'text-foreground/30'}`}>
          {text.length}/{limit}
        </span>
      </div>
      {multiline ? (
        <Textarea {...shared} rows={rows} className={over ? 'border-destructive/60' : ''} />
      ) : (
        <Input {...shared} className={over ? 'border-destructive/60' : ''} />
      )}
      {over ? (
        <div className="flex items-center gap-2 mt-1">
          <span className="text-[11px] text-destructive leading-snug">
            {text.length - limit} character{text.length - limit === 1 ? '' : 's'} over — the Common App will not accept this field.
          </span>
          <button
            type="button"
            onClick={onTrim}
            className="inline-flex items-center gap-1 text-[11px] font-medium text-accent hover:underline shrink-0"
          >
            <Scissors className="w-3 h-3" /> Trim at a word boundary
          </button>
        </div>
      ) : (hint && !text ? (
        <p className="text-[11px] text-foreground/30 mt-1 leading-snug">{hint}</p>
      ) : null)}
    </div>
  );
}

export default function ActivitiesEditor({ value = [], onChange, onSharpen, sharpeningIndex = null }) {
  const update = (index, field, val) => {
    const next = [...value];
    next[index] = { ...next[index], [field]: val };
    onChange(next);
  };

  /** Cuts one field to its limit at a word boundary, on the applicant's click. */
  const trim = (index, field, limit) => {
    const fitted = fitActivityField(value[index]?.[field], limit);
    update(index, field, fitted.text);
  };

  const add = () => {
    if (value.length >= MAX_ACTIVITIES) return;
    onChange([...value, {
      activity_type: '', position: '', organization: '', description: '',
      grade_levels: [], timing: '', hours_per_week: null, weeks_per_year: null,
    }]);
  };

  const remove = (index) => {
    const activity = value[index];
    const label = activity?.position || activity?.organization || activity?.description?.slice(0, 40) || `activity ${index + 1}`;
    // Deleting an entry is the only irreversible action on this page, so it asks
    // first and names what is about to go.
    if (!window.confirm(`Delete this activity?\n\n${label}\n\nIt is removed from your profile when you save.`)) return;
    onChange(value.filter((_, i) => i !== index));
  };

  const toggleGrade = (index, grade) => {
    const current = value[index]?.grade_levels || [];
    const next = current.includes(grade) ? current.filter((g) => g !== grade) : [...current, grade];
    update(index, 'grade_levels', next);
  };

  return (
    <div className="space-y-3">
      {value.length > 0 && (
        <p className="text-[11px] text-foreground/40 leading-relaxed">
          Ten slots, read top to bottom — the first two or three carry the argument.
          Position {POSITION_LIMIT} characters, organization {ORG_LIMIT}, description {DESC_LIMIT}.
          Lead with the verb, keep the number, and do not repeat the position or the organization inside the description.
        </p>
      )}
      {value.map((activity, i) => (
        <div key={i} className="border border-border rounded-lg p-4 space-y-3 bg-muted/20 relative">
          <div className="flex items-center justify-between mb-1 gap-2">
            <span className="text-xs font-medium text-foreground/40">Activity {i + 1}</span>
            <div className="flex items-center gap-1.5">
              {onSharpen && (
                <button
                  type="button"
                  onClick={() => onSharpen(i)}
                  disabled={sharpeningIndex !== null}
                  className="inline-flex items-center gap-1 text-[11px] font-medium text-accent hover:underline transition disabled:opacity-50"
                >
                  <Wand2 className="w-3 h-3" />
                  {sharpeningIndex === i ? 'Sharpening…' : 'Sharpen with AI'}
                </button>
              )}
              <button
                type="button"
                onClick={() => remove(i)}
                aria-label={`Delete activity ${i + 1}`}
                className="p-1 rounded text-foreground/20 hover:text-destructive transition"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="min-w-0">
              <label className="block text-xs font-medium text-foreground/50 mb-1">Type</label>
              <Select value={activity.activity_type || ''} onValueChange={(v) => update(i, 'activity_type', v)}>
                <SelectTrigger className="w-full"><SelectValue placeholder="Select..." /></SelectTrigger>
                <SelectContent>
                  {ACTIVITY_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <CappedField
              label="Position / Leadership"
              value={activity.position}
              limit={POSITION_LIMIT}
              onChange={(v) => update(i, 'position', v)}
              onTrim={() => trim(i, 'position', POSITION_LIMIT)}
              placeholder="e.g. Captain, Varsity Swimming"
              hint="Title plus the level: “Founder” says less than “Founder & President”."
            />
            <CappedField
              label="Organization"
              value={activity.organization}
              limit={ORG_LIMIT}
              onChange={(v) => update(i, 'organization', v)}
              onTrim={() => trim(i, 'organization', ORG_LIMIT)}
              placeholder="e.g. Lincoln High Robotics"
              hint="Where it happened, and the city or school if the reader will not know it."
            />
          </div>

          <CappedField
            label="Description"
            value={activity.description}
            limit={DESC_LIMIT}
            onChange={(v) => update(i, 'description', v)}
            onTrim={() => trim(i, 'description', DESC_LIMIT)}
            placeholder="What you did and what it produced…"
            multiline
            hint="Impact first, then scope: the number of people, the money, the result. No “responsible for”."
          />

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-foreground/50 mr-1">Grades:</span>
            {GRADE_LEVELS.map((g) => (
              <button
                key={g}
                type="button"
                onClick={() => toggleGrade(i, g)}
                className={`px-2.5 py-1 rounded-md text-xs font-medium transition ${
                  (activity.grade_levels || []).includes(g)
                    ? 'bg-foreground text-background'
                    : 'bg-muted text-foreground/50 hover:bg-muted/70'
                }`}
              >
                {g}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="min-w-0">
              <label className="block text-xs font-medium text-foreground/50 mb-1">Timing</label>
              <Select value={activity.timing || ''} onValueChange={(v) => update(i, 'timing', v)}>
                <SelectTrigger className="w-full"><SelectValue placeholder="When?" /></SelectTrigger>
                <SelectContent>
                  {TIMING_OPTIONS.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="min-w-0">
              <label className="block text-xs font-medium text-foreground/50 mb-1">Hrs / week</label>
              <Input type="number" min="0" max={HOURS_PER_WEEK_MAX} step="any" value={activity.hours_per_week ?? ''} onChange={(e) => update(i, 'hours_per_week', cleanAmount(e.target.value, HOURS_PER_WEEK_MAX))} placeholder="0" />
            </div>
            <div className="min-w-0">
              <label className="block text-xs font-medium text-foreground/50 mb-1">Weeks / year</label>
              <Input type="number" min="0" max={WEEKS_PER_YEAR_MAX} step="1" value={activity.weeks_per_year ?? ''} onChange={(e) => update(i, 'weeks_per_year', cleanAmount(e.target.value, WEEKS_PER_YEAR_MAX, true))} placeholder="0" />
            </div>
          </div>
        </div>
      ))}
      {value.length < MAX_ACTIVITIES ? (
        <Button variant="outline" size="sm" onClick={add}>
          <Plus className="w-3.5 h-3.5 mr-1" />
          Add Activity ({value.length}/{MAX_ACTIVITIES})
        </Button>
      ) : (
        <p className="text-[11px] text-foreground/40">
          All {MAX_ACTIVITIES} Common App slots are used. Merge two related entries if a stronger one is waiting.
        </p>
      )}
    </div>
  );
}
