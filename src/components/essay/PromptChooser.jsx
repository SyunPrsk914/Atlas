import { useMemo } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Textarea } from '@/components/ui/textarea';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { fixedPromptChoices } from '@/lib/supplementPrompts';
import { isAmbiguousCommonAppPrompt, isCommonAppPersonalStatement } from '@/lib/applicationData';

const CUSTOM = '__custom__';
const UNSET = '__unset__';

/**
 * Known prompts are chosen, not pasted. A free-text box remains for a school
 * whose 2026-27 wording is not in the catalog.
 */
export default function PromptChooser({
  platform,
  universityName,
  scope,
  value,
  onChange,
  onPick,
  rows = 4,
}) {
  const choices = useMemo(
    () => fixedPromptChoices({ platform, universityName, scope }),
    [platform, universityName, scope],
  );
  const matched = choices.find((choice) => choice.prompt && choice.prompt === value);
  const ambiguous = isAmbiguousCommonAppPrompt(value);
  const groups = [];
  for (const choice of choices) {
    let group = groups.find((item) => item.label === choice.group);
    if (!group) {
      group = { label: choice.group, items: [] };
      groups.push(group);
    }
    group.items.push(choice);
  }

  if (!choices.length) {
    return (
      <Textarea
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Paste the exact prompt from the university's application…"
        rows={rows}
      />
    );
  }

  return (
    <div className="space-y-2">
      <Select
        value={matched ? matched.key : (value ? CUSTOM : UNSET)}
        onValueChange={(key) => {
          if (key === CUSTOM) {
            onChange(matched ? '' : (value || ''));
            return;
          }
          if (key === UNSET) {
            onChange('');
            return;
          }
          const choice = choices.find((item) => item.key === key);
          if (!choice) return;
          onChange(choice.prompt);
          onPick?.(choice);
        }}
      >
        <SelectTrigger className="w-full">
          <SelectValue placeholder="Choose the official prompt" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={UNSET}>Choose a prompt</SelectItem>
          {groups.map((group) => (
            group.items.map((item) => (
              <SelectItem key={item.key} value={item.key}>
                {item.label}
              </SelectItem>
            ))
          ))}
          <SelectItem value={CUSTOM}>The prompt is not in this list — I’ll paste it</SelectItem>
        </SelectContent>
      </Select>

      {ambiguous && (
        <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2.5 flex gap-2">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          This field currently contains more than one official prompt. Choose the single prompt you are
          actually answering — otherwise the draft tries to answer all of them.
        </p>
      )}

      {matched ? (
        <div className="rounded-lg border border-border bg-muted/20 p-3 space-y-1.5">
          <p className="text-sm text-foreground/75 leading-relaxed">{matched.prompt}</p>
          {matched.meta && <p className="text-[11px] text-foreground/40">{matched.meta}</p>}
          {matched.role && (
            <p className="text-xs text-foreground/55 leading-relaxed">
              <span className="font-medium">What it is testing: </span>{matched.role}
            </p>
          )}
          {matched.warn && (
            <p className="text-xs text-amber-700 leading-relaxed">{matched.warn}</p>
          )}
          {matched.source && (
            <a href={matched.source} target="_blank" rel="noopener noreferrer" className="text-[11px] text-accent hover:underline">
              Official source · confirm before you submit
            </a>
          )}
        </div>
      ) : (
        <Textarea
          value={value || ''}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Paste the exact prompt…"
          rows={rows}
        />
      )}

      {scope === 'common' && platform === 'common_app' && !value && (
        <p className="text-[11px] text-foreground/40">
          The Common App personal statement is one of these seven prompts, 250–650 words, sent unchanged to every Common App school.
        </p>
      )}
    </div>
  );
}

export function promptNeedsChoice(essay) {
  if (!essay) return false;
  if (isCommonAppPersonalStatement(essay) && (!essay.prompt || isAmbiguousCommonAppPrompt(essay.prompt))) return true;
  return false;
}
