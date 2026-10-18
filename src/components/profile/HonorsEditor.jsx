import { useState } from 'react';
import { Plus, Trash2, Wand2, KeyRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { HONOR_LIMITS } from '@/lib/honorPrompts';
import { fitActivityField } from '@/lib/activityPrompts';

const NAME_LIMIT = HONOR_LIMITS.name;
const MAX_HONORS = HONOR_LIMITS.maxHonors;
const GRADE_LEVELS = HONOR_LIMITS.gradeLevels;
const RECOGNITION_LEVELS = HONOR_LIMITS.levels;

/**
 * The honor name, with its Common App limit shown rather than enforced by
 * `maxLength`: the same rule the activities fields follow — pasting a long
 * name must not silently destroy the tail. Over the limit turns red and offers
 * an explicit Trim that cuts at a word boundary.
 */
function HonorNameField({ value, onChange }) {
  const text = String(value || '');
  const over = text.length > NAME_LIMIT;
  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between gap-2 mb-1">
        <label className="text-xs font-medium text-foreground/50 truncate">Name of honor</label>
        <span className={`text-[11px] font-mono shrink-0 ${over ? 'text-destructive font-semibold' : 'text-foreground/30'}`}>
          {text.length}/{NAME_LIMIT}
        </span>
      </div>
      <Input
        value={text}
        onChange={(e) => onChange(e.target.value)}
        placeholder="e.g. National Merit Scholarship — Commended Student"
        className={over ? 'border-destructive/60' : ''}
      />
      {over && (
        <div className="flex items-center gap-2 mt-1">
          <span className="text-[11px] text-destructive leading-snug">
            {text.length - NAME_LIMIT} character{text.length - NAME_LIMIT === 1 ? '' : 's'} over — the Common App will not accept this field.
          </span>
          <button
            type="button"
            onClick={() => onChange(fitActivityField(text, NAME_LIMIT).text)}
            className="text-[11px] text-accent hover:underline shrink-0"
          >
            Trim at a word boundary
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * The Common App honors list.
 *
 * `note` on each entry is the applicant's private box — the same deal as an
 * activity's keywords: the awarding body, the pool it was cut from, the tier,
 * who nominated them. It is never submitted; it is what the “Sharpen wording”
 * pass builds from, so the AI strengthens the line with their facts instead of
 * dressing it up with invented ones.
 *
 * `onSharpen(index)` hands one entry to the AI panel (the parent owns the job,
 * the same split as the activities editor); `sharpeningIndex` marks it busy and
 * freezes the other buttons while the model reads.
 */
export default function HonorsEditor({ value = [], onChange, onSharpen, sharpeningIndex = null }) {
  const [notesOpen, setNotesOpen] = useState(() => value.some((h) => String(h?.note || '').trim()));

  const update = (index, field, val) => {
    const next = [...value];
    next[index] = { ...next[index], [field]: val };
    onChange(next);
  };

  const add = () => {
    if (value.length >= MAX_HONORS) return;
    onChange([...value, { name: '', grade_level: '', level: '', note: '' }]);
  };

  const remove = (index) => {
    onChange(value.filter((_, i) => i !== index));
  };

  const busy = sharpeningIndex !== null;

  return (
    <div className="space-y-3">
      {value.map((honor, i) => (
        <div key={i} className="rounded-lg border border-border p-3 space-y-2">
          <div className="flex items-end gap-3">
            <div className="flex-1 min-w-0">
              <HonorNameField value={honor.name} onChange={(v) => update(i, 'name', v)} />
            </div>
            <div className="w-24 shrink-0">
              <label className="block text-xs font-medium text-foreground/50 mb-1">Grade</label>
              <Select value={honor.grade_level || ''} onValueChange={(v) => update(i, 'grade_level', v)} disabled={busy}>
                <SelectTrigger className="w-full"><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  {GRADE_LEVELS.map((g) => <SelectItem key={g} value={g}>{g}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="w-36 shrink-0">
              <label className="block text-xs font-medium text-foreground/50 mb-1">Level</label>
              <Select value={honor.level || ''} onValueChange={(v) => update(i, 'level', v)} disabled={busy}>
                <SelectTrigger className="w-full"><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  {RECOGNITION_LEVELS.map((l) => <SelectItem key={l} value={l}>{l}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-0.5 mb-0.5 shrink-0">
              {onSharpen && (
                <button
                  onClick={() => onSharpen(i)}
                  disabled={busy || !String(honor.name || '').trim()}
                  title={!String(honor.name || '').trim() ? 'Give the honor a name first — sharpening rewords what exists, it does not invent one' : 'Rewrite this name from your facts. Atlas shows the change; you decide.'}
                  className="px-2 py-1 rounded-md text-[11px] inline-flex items-center gap-1 text-foreground/40 hover:text-accent hover:bg-accent/5 transition disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Wand2 className="w-3 h-3" />
                  {sharpeningIndex === i ? 'Sharpening…' : 'Sharpen'}
                </button>
              )}
              <button
                onClick={() => setNotesOpen((open) => !open)}
                aria-expanded={notesOpen}
                title="Private note for Atlas: who gave it, what it was chosen from, the tier — never submitted"
                className={`p-2 rounded-md transition ${notesOpen || String(honor.note || '').trim() ? 'text-accent' : 'text-foreground/25 hover:text-foreground/60'}`}
              >
                <KeyRound className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => remove(i)}
                disabled={busy}
                className="p-2 rounded text-foreground/20 hover:text-destructive transition disabled:opacity-30"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
          {notesOpen && (
            <div className="space-y-1">
              <label className="block text-[11px] font-medium text-foreground/50">
                Your note for the AI (not submitted) — the official name, the tier, how many it was cut from, who nominated you
              </label>
              <Textarea
                value={honor.note || ''}
                onChange={(e) => update(i, 'note', e.target.value)}
                rows={2}
                placeholder={'e.g. Japan Physics Olympiad — Silver (top 12 of ~2,400); nominated by the school; awarded at the Osaka ceremony Mar 2025'}
                className="text-sm"
              />
            </div>
          )}
        </div>
      ))}
      <div className="flex items-center gap-3 flex-wrap">
        {value.length < MAX_HONORS && (
          <Button variant="outline" size="sm" onClick={add}>
            <Plus className="w-3.5 h-3.5 mr-1" />
            Add Honor ({value.length}/{MAX_HONORS})
          </Button>
        )}
        {value.length >= MAX_HONORS && (
          <p className="text-[11px] text-foreground/45">
            The Common App holds {MAX_HONORS} honors. The order is your claim about which recognition defines you — put the hardest one first.
          </p>
        )}
      </div>
    </div>
  );
}
