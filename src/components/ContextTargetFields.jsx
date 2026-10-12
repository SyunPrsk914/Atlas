import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { PLATFORMS, PLATFORM_VALUES } from '@/lib/applicationData';
import { CONTEXT_TASKS } from '@/lib/contextTargeting';

const NONE = '__none__';

/** Reusable, cumulative context targeting for a material or knowledge entry. */
export default function ContextTargetFields({ value = {}, onChange, universities = [], essays = [] }) {
  const update = (patch) => onChange?.(patch);
  const universityId = String(value.target_university_id || '');
  const essayId = String(value.target_essay_id || '');
  const hasUniversity = universities.some((item) => String(item.id) === universityId);
  const hasEssay = essays.some((item) => String(item.id) === essayId);

  return (
    <div className="rounded-lg border border-border bg-muted/20 p-3 space-y-3">
      <div>
        <p className="text-xs font-medium text-foreground/70">Where should Atlas use this?</p>
        <p className="text-[11px] text-foreground/40 mt-0.5">
          Leave targets blank to use it everywhere. University, essay, platform, and AI-task limits stack, so every selected target must match.
        </p>
      </div>

      <div className="grid sm:grid-cols-2 gap-3">
        <div>
          <Label className="block text-[11px] text-foreground/50 mb-1">University (optional)</Label>
          <Select
            value={universityId || NONE}
            onValueChange={(next) => update({ target_university_id: next === NONE ? '' : next })}
          >
            <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>Any university</SelectItem>
              {universityId && !hasUniversity && (
                <SelectItem value={universityId}>Saved university (not on the current list)</SelectItem>
              )}
              {universities.map((item) => (
                <SelectItem key={item.id} value={String(item.id)}>{item.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label className="block text-[11px] text-foreground/50 mb-1">Essay (optional)</Label>
          <Select
            value={essayId || NONE}
            onValueChange={(next) => update({ target_essay_id: next === NONE ? '' : next })}
          >
            <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>Any essay</SelectItem>
              {essayId && !hasEssay && (
                <SelectItem value={essayId}>Saved essay (not in the current list)</SelectItem>
              )}
              {essays.map((item) => (
                <SelectItem key={item.id} value={String(item.id)}>
                  {item.title || 'Untitled essay'}{item.university_name ? ` · ${item.university_name}` : item.scope === 'common' ? ' · Shared' : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label className="block text-[11px] text-foreground/50 mb-1">Application platform (optional)</Label>
          <Select
            value={value.target_platform || NONE}
            onValueChange={(next) => update({ target_platform: next === NONE ? '' : next })}
          >
            <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>Any platform</SelectItem>
              {PLATFORM_VALUES.map((platform) => (
                <SelectItem key={platform} value={platform}>{PLATFORMS[platform]?.label || platform}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label className="block text-[11px] text-foreground/50 mb-1">AI task (optional)</Label>
          <Select
            value={value.target_task || NONE}
            onValueChange={(next) => update({ target_task: next === NONE ? '' : next })}
          >
            <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>Any task</SelectItem>
              {Object.entries(CONTEXT_TASKS).map(([task, label]) => (
                <SelectItem key={task} value={task}>{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  );
}
