import { AlertTriangle } from 'lucide-react';
import { Textarea } from '@/components/ui/textarea';
import { ucasQuestionsFrom, ucasCharacterBudget, UCAS_RULES } from '@/lib/applicationData';

/**
 * The real UCAS form: three fixed questions, three answer boxes, one shared
 * 4,000-character budget (spaces included), 350 minimum each.
 */
export default function UcasStatementEditor({ essays, focusId, onChange, onFocus }) {
  const rows = ucasQuestionsFrom(essays);
  const budget = ucasCharacterBudget(essays);

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <p className="text-sm font-medium">UCAS personal statement</p>
          <p className="text-xs text-foreground/45 mt-0.5 max-w-xl leading-relaxed">
            Three official questions, three separate answers, one statement. UCAS sends the same wording
            to every course choice, so do not name a university. {UCAS_RULES.academicBias}
          </p>
        </div>
        <p className={`text-xs font-medium ${budget.over ? 'text-destructive' : 'text-foreground/50'}`}>
          {budget.total.toLocaleString()} / {budget.limit.toLocaleString()} characters
          {budget.over
            ? ` · ${Math.abs(budget.remaining).toLocaleString()} over`
            : ` · ${budget.remaining.toLocaleString()} remaining`}
        </p>
      </div>

      {budget.over && (
        <div className="flex items-start gap-2 p-2.5 rounded-lg bg-red-50 border border-red-200">
          <AlertTriangle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
          <p className="text-xs text-red-700">
            The three answers together are over 4,000 characters. UCAS counts spaces and will not accept the statement.
          </p>
        </div>
      )}

      {rows.map(({ question, essay }) => {
        const text = essay?.content || '';
        const focused = essay?.id && essay.id === focusId;
        const short = text.length > 0 && text.length < question.minChars;
        return (
          <div
            key={question.key}
            className={`rounded-xl border p-4 space-y-2 ${focused ? 'border-foreground/25 bg-card' : 'border-border bg-card/60'}`}
            onFocus={() => essay && onFocus?.(essay)}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-medium">
                  {question.number}. {question.label}
                </p>
                <p className="text-sm text-foreground/70 mt-1 leading-relaxed">{question.prompt}</p>
                <p className="text-[11px] text-foreground/40 mt-1 leading-relaxed">
                  {question.role} Aim for {question.suggestedShare}.
                </p>
              </div>
              <p className={`text-[11px] font-medium shrink-0 ${short ? 'text-amber-700' : 'text-foreground/40'}`}>
                {text.length.toLocaleString()} characters
                {short ? ` · under the ${question.minChars} minimum` : ` · min ${question.minChars}`}
              </p>
            </div>
            {essay ? (
              <Textarea
                value={text}
                onChange={(e) => onChange(essay, e.target.value)}
                onFocus={() => onFocus?.(essay)}
                rows={question.number === 1 ? 8 : 6}
                placeholder="Write this answer only. The other two questions have their own boxes."
                className="font-body leading-relaxed"
              />
            ) : (
              <p className="text-xs text-foreground/40">
                This question has not been created yet. Add the shared UCAS answers from the banner above.
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
