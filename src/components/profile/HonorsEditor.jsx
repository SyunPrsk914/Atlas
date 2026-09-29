import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const GRADE_LEVELS = ['9', '10', '11', '12', 'PG'];
const RECOGNITION_LEVELS = ['School', 'State', 'National', 'International'];
const MAX_HONORS = 5;

export default function HonorsEditor({ value = [], onChange }) {
  const update = (index, field, val) => {
    const next = [...value];
    next[index] = { ...next[index], [field]: val };
    onChange(next);
  };

  const add = () => {
    if (value.length >= MAX_HONORS) return;
    onChange([...value, { name: '', grade_level: '', level: '' }]);
  };

  const remove = (index) => {
    onChange(value.filter((_, i) => i !== index));
  };

  return (
    <div className="space-y-3">
      {value.map((honor, i) => (
        <div key={i} className="flex items-end gap-3">
          <div className="flex-1">
            <label className="block text-xs font-medium text-foreground/50 mb-1">Honor {i + 1}</label>
            <Input value={honor.name || ''} onChange={(e) => update(i, 'name', e.target.value)} placeholder="e.g. National Merit Finalist" />
          </div>
          <div className="w-24">
            <label className="block text-xs font-medium text-foreground/50 mb-1">Grade</label>
            <Select value={honor.grade_level || ''} onValueChange={(v) => update(i, 'grade_level', v)}>
              <SelectTrigger className="w-full"><SelectValue placeholder="—" /></SelectTrigger>
              <SelectContent>
                {GRADE_LEVELS.map((g) => <SelectItem key={g} value={g}>{g}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="w-36">
            <label className="block text-xs font-medium text-foreground/50 mb-1">Level</label>
            <Select value={honor.level || ''} onValueChange={(v) => update(i, 'level', v)}>
              <SelectTrigger className="w-full"><SelectValue placeholder="—" /></SelectTrigger>
              <SelectContent>
                {RECOGNITION_LEVELS.map((l) => <SelectItem key={l} value={l}>{l}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <button
            onClick={() => remove(i)}
            className="p-2 mb-0.5 rounded text-foreground/20 hover:text-destructive transition shrink-0"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      ))}
      {value.length < MAX_HONORS && (
        <Button variant="outline" size="sm" onClick={add}>
          <Plus className="w-3.5 h-3.5 mr-1" />
          Add Honor ({value.length}/{MAX_HONORS})
        </Button>
      )}
    </div>
  );
}