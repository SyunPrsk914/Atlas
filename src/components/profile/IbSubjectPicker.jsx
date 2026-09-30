import { useState, useMemo } from 'react';
import { Plus, X, GraduationCap, Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  IB_SUBJECT_GROUPS, IB_LEVELS, IB_PREDICTED_GRADES, findSubjectGroup,
} from '@/lib/profileOptions';

const HL_LIMIT = 3;
const TOTAL_LIMIT = 10;

/**
 * IB subject picker.
 *
 * This was previously a single free-text textarea, which meant typos, missing
 * HL/SL, missing predicted grades, and an AI that could not tell "Physics" from
 * "physics higher level". The IB Diploma has a fixed, published subject list, so
 * it is a picker; free typing is still available for subjects not on the list.
 *
 * Output is serialised into the existing `profiles.ib_subjects` text column, so
 * nothing about the database changes and older free-text values are parsed back
 * into the picker on load.
 */
export default function IbSubjectPicker({ value = [], onChange }) {
  const [group, setGroup] = useState('1');
  const [query, setQuery] = useState('');

  const selectedNames = useMemo(
    () => new Set(value.map((s) => s.name)),
    [value],
  );
  const hlCount = value.filter((s) => s.level === 'HL').length;

  const visibleSubjects = useMemo(() => {
    const g = IB_SUBJECT_GROUPS.find((x) => String(x.group) === group);
    const list = g ? g.subjects : [];
    const q = query.trim().toLowerCase();
    if (!q) return list;
    // Searching searches every group — the student knows the subject, not the group.
    const all = IB_SUBJECT_GROUPS.flatMap((x) => x.subjects);
    const hits = new Set(all.filter((s) => s.toLowerCase().includes(q)));
    return list.filter((s) => hits.has(s));
  }, [group, query]);

  const add = (name) => {
    if (value.length >= TOTAL_LIMIT) return;
    if (selectedNames.has(name)) return;
    onChange([...value, { name, level: 'HL', grade: '' }]);
    setQuery('');
  };

  const update = (index, patch) => {
    onChange(value.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  };

  const remove = (index) => onChange(value.filter((_, i) => i !== index));

  const atLimit = value.length >= TOTAL_LIMIT;

  return (
    <div className="space-y-3">
      {value.length > 0 && (
        <div className="space-y-1.5">
          {value.map((subject, i) => {
            const groupInfo = findSubjectGroup(subject.name);
            return (
              <div
                key={`${subject.name}-${i}`}
                className="flex items-center gap-2 p-2.5 rounded-lg border border-border bg-muted/20"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{subject.name}</p>
                  <p className="text-[11px] text-foreground/40">
                    {groupInfo ? `IB Group ${groupInfo.group}` : 'Custom subject'}
                  </p>
                </div>

                <Select
                  value={subject.level || 'HL'}
                  onValueChange={(v) => update(i, { level: v })}
                >
                  <SelectTrigger className="w-24 h-8">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {IB_LEVELS.map((l) => <SelectItem key={l} value={l}>{l}</SelectItem>)}
                  </SelectContent>
                </Select>

                <Select
                  value={subject.grade || 'none'}
                  onValueChange={(v) => update(i, { grade: v === 'none' ? '' : v })}
                >
                  <SelectTrigger className="w-28 h-8">
                    <SelectValue placeholder="Predicted" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No grade</SelectItem>
                    {IB_PREDICTED_GRADES.map((g) => (
                      <SelectItem key={g} value={g}>{g === 'EE' ? 'EE' : `${g}/7`}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <button
                  onClick={() => remove(i)}
                  className="p-1.5 rounded text-foreground/25 hover:text-destructive transition shrink-0"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {atLimit ? (
        <p className="text-xs text-foreground/40 flex items-center gap-1.5">
          <Info className="w-3.5 h-3.5" />
          Six subjects is the IB maximum. Remove one to change your selection.
        </p>
      ) : (
        <div className="border border-border rounded-lg p-3 space-y-2.5">
          <div className="flex items-center gap-2">
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search IB subjects…"
              className="h-8"
            />
            <Button size="sm" variant="outline" onClick={() => query.trim() && add(query.trim())} disabled={!query.trim()}>
              <Plus className="w-3.5 h-3.5 mr-1" /> Add
            </Button>
          </div>

          {!query && (
            <div className="flex flex-wrap gap-1.5">
              {IB_SUBJECT_GROUPS.map((g) => (
                <button
                  key={g.group}
                  onClick={() => setGroup(String(g.group))}
                  className={`px-2 py-1 rounded-md text-[11px] font-medium transition ${
                    String(g.group) === group
                      ? 'bg-foreground text-background'
                      : 'bg-muted text-foreground/55 hover:bg-muted/70'
                  }`}
                  title={g.label}
                >
                  Group {g.group}
                </button>
              ))}
            </div>
          )}

          <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto">
            {visibleSubjects.map((name) => {
              const already = selectedNames.has(name);
              return (
                <button
                  key={name}
                  onClick={() => !already && add(name)}
                  disabled={already}
                  className={`px-2 py-1 rounded-md text-[11px] font-medium text-left transition ${
                    already
                      ? 'bg-muted text-foreground/25 cursor-default'
                      : 'bg-muted/60 text-foreground/65 hover:bg-foreground hover:text-background'
                  }`}
                >
                  {name}
                </button>
              );
            })}
            {visibleSubjects.length === 0 && (
              <p className="text-[11px] text-foreground/40 px-1 py-2">
                Nothing matched. Press Add to add “{query.trim()}” as a custom subject.
              </p>
            )}
          </div>
        </div>
      )}

      <div className="flex items-center gap-2 flex-wrap">
        <Badge variant="outline" className="gap-1">
          <GraduationCap className="w-3 h-3" />
          {value.length}/{TOTAL_LIMIT} subjects
        </Badge>
        <Badge variant="outline" className={hlCount > HL_LIMIT ? 'text-destructive border-destructive/40' : ''}>
          {hlCount} HL{hlCount > HL_LIMIT ? ' — over the IB maximum of 3' : ` (max ${HL_LIMIT})`}
        </Badge>
        {value.length > 0 && (
          <span className="text-[11px] text-foreground/35">
            Written out as “{value.map((s) => `${s.name} ${s.level}${s.grade ? ` (${s.grade})` : ''}`).join(', ')}”
          </span>
        )}
      </div>
    </div>
  );
}
