import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const ACTIVITY_TYPES = [
  'Academic', 'Art', 'Athletics: Club', 'Athletics: JV', 'Athletics: Varsity',
  'Career-Oriented', 'Community Service (Volunteer)', 'Computer/Technology',
  'Dance', 'Debate/Speech', 'Environmental', 'Family Responsibilities',
  'Foreign Exchange', 'Journalism/Publication', 'Junior ROTC', 'LGBT',
  'Music: Instrumental', 'Music: Vocal', 'Religious', 'Research', 'Robotics',
  'School Spirit', 'Social Justice', 'Student Govt./Politics', 'Theater',
  'Tutoring', 'Work (Paid)', 'Other Club/Activity',
];

const TIMING_OPTIONS = ['School year', 'School break', 'Summer', 'All year'];
const GRADE_LEVELS = ['9', '10', '11', '12', 'PG'];

const MAX_ACTIVITIES = 10;
const DESC_LIMIT = 150;
// Hours and weeks are typed into number inputs. Only a finite, non-negative
// number is kept, capped at what a week or a year can hold, so "-5" or "1e3"
// cannot be saved.
const HOURS_PER_WEEK_MAX = 168;
const WEEKS_PER_YEAR_MAX = 52;
const cleanAmount = (raw, max, whole = false) => {
  if (raw === '' || raw == null) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.min(whole ? Math.trunc(n) : n, max);
};

export default function ActivitiesEditor({ value = [], onChange }) {
  const update = (index, field, val) => {
    const next = [...value];
    next[index] = { ...next[index], [field]: val };
    onChange(next);
  };

  const add = () => {
    if (value.length >= MAX_ACTIVITIES) return;
    onChange([...value, {
      activity_type: '', position: '', organization: '', description: '',
      grade_levels: [], timing: '', hours_per_week: null, weeks_per_year: null,
    }]);
  };

  const remove = (index) => {
    onChange(value.filter((_, i) => i !== index));
  };

  const toggleGrade = (index, grade) => {
    const current = value[index]?.grade_levels || [];
    const next = current.includes(grade) ? current.filter((g) => g !== grade) : [...current, grade];
    update(index, 'grade_levels', next);
  };

  return (
    <div className="space-y-3">
      {value.map((activity, i) => (
        <div key={i} className="border border-border rounded-lg p-4 space-y-3 bg-muted/20 relative">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-medium text-foreground/40">Activity {i + 1}</span>
            <button
              onClick={() => remove(i)}
              className="p-1 rounded text-foreground/20 hover:text-destructive transition"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-foreground/50 mb-1">Type</label>
              <Select value={activity.activity_type || ''} onValueChange={(v) => update(i, 'activity_type', v)}>
                <SelectTrigger className="w-full"><SelectValue placeholder="Select..." /></SelectTrigger>
                <SelectContent>
                  {ACTIVITY_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="block text-xs font-medium text-foreground/50 mb-1">Position / Leadership</label>
              <Input value={activity.position || ''} onChange={(e) => update(i, 'position', e.target.value)} placeholder="e.g. President, Member" />
            </div>
            <div>
              <label className="block text-xs font-medium text-foreground/50 mb-1">Organization</label>
              <Input value={activity.organization || ''} onChange={(e) => update(i, 'organization', e.target.value)} placeholder="e.g. Key Club" />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-medium text-foreground/50">Description</label>
              <span className={`text-xs ${(activity.description || '').length > DESC_LIMIT ? 'text-destructive' : 'text-foreground/30'}`}>
                {(activity.description || '').length}/{DESC_LIMIT}
              </span>
            </div>
            <Textarea
              value={activity.description || ''}
              onChange={(e) => update(i, 'description', e.target.value.slice(0, DESC_LIMIT))}
              placeholder="Describe what you did and what you accomplished..."
              rows={2}
              maxLength={DESC_LIMIT}
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-foreground/50 mr-1">Grades:</span>
            {GRADE_LEVELS.map((g) => (
              <button
                key={g}
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

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-foreground/50 mb-1">Timing</label>
              <Select value={activity.timing || ''} onValueChange={(v) => update(i, 'timing', v)}>
                <SelectTrigger className="w-full"><SelectValue placeholder="When?" /></SelectTrigger>
                <SelectContent>
                  {TIMING_OPTIONS.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="block text-xs font-medium text-foreground/50 mb-1">Hrs / week</label>
              <Input type="number" min="0" max={HOURS_PER_WEEK_MAX} step="any" value={activity.hours_per_week ?? ''} onChange={(e) => update(i, 'hours_per_week', cleanAmount(e.target.value, HOURS_PER_WEEK_MAX))} placeholder="0" />
            </div>
            <div>
              <label className="block text-xs font-medium text-foreground/50 mb-1">Weeks / year</label>
              <Input type="number" min="0" max={WEEKS_PER_YEAR_MAX} step="1" value={activity.weeks_per_year ?? ''} onChange={(e) => update(i, 'weeks_per_year', cleanAmount(e.target.value, WEEKS_PER_YEAR_MAX, true))} placeholder="0" />
            </div>
          </div>
        </div>
      ))}
      {value.length < MAX_ACTIVITIES && (
        <Button variant="outline" size="sm" onClick={add}>
          <Plus className="w-3.5 h-3.5 mr-1" />
          Add Activity ({value.length}/{MAX_ACTIVITIES})
        </Button>
      )}
    </div>
  );
}