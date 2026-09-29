import { Button } from '@/components/ui/button';
import { ClipboardCheck, CheckCircle2, AlertCircle, Sparkles, Loader2, Bot } from 'lucide-react';

export default function EssayReviewPanel({ reviewResult, onPolish, polishing }) {
  if (!reviewResult) return null;

  const scoreColor = reviewResult.overall_score >= 7 ? 'text-green-600' : reviewResult.overall_score >= 5 ? 'text-accent' : 'text-destructive';

  return (
    <div className="bg-card border border-border rounded-xl p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ClipboardCheck className="w-4 h-4 text-foreground/50" />
          <span className="font-display text-lg font-semibold">Admission Officer Review</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-foreground/40">Score:</span>
          <span className={`font-display text-2xl font-bold ${scoreColor}`}>{reviewResult.overall_score}/10</span>
        </div>
      </div>

      {reviewResult.sounds_like_ai && (
        <div className="bg-destructive/5 border border-destructive/20 rounded-lg p-3.5 flex items-start gap-2.5">
          <Bot className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-destructive">This essay sounds AI-generated</p>
            {reviewResult.ai_patterns_detected && reviewResult.ai_patterns_detected.length > 0 && (
              <ul className="text-xs text-destructive/80 mt-1.5 space-y-0.5">
                {reviewResult.ai_patterns_detected.map((p, i) => (
                  <li key={i}>• {p}</li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {reviewResult.prompt_alignment_score !== undefined && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-foreground/40">Prompt alignment:</span>
          <div className="flex gap-0.5">
            {Array.from({ length: 10 }, (_, i) => (
              <div key={i} className={`w-3 h-1.5 rounded-full ${i < reviewResult.prompt_alignment_score ? 'bg-accent' : 'bg-muted'}`} />
            ))}
          </div>
          <span className="text-xs font-medium">{reviewResult.prompt_alignment_score}/10</span>
        </div>
      )}

      <p className="text-sm text-foreground/60 leading-relaxed italic">"{reviewResult.summary}"</p>

      {reviewResult.strengths && reviewResult.strengths.length > 0 && (
        <div>
          <h4 className="text-sm font-medium flex items-center gap-1.5 mb-2 text-green-600">
            <CheckCircle2 className="w-4 h-4" /> Strengths
          </h4>
          <ul className="space-y-1.5">
            {reviewResult.strengths.map((s, i) => (
              <li key={i} className="text-sm text-foreground/60 flex gap-2">
                <span className="text-green-500 mt-0.5">•</span>{s}
              </li>
            ))}
          </ul>
        </div>
      )}

      {reviewResult.weaknesses && reviewResult.weaknesses.length > 0 && (
        <div>
          <h4 className="text-sm font-medium flex items-center gap-1.5 mb-2 text-destructive">
            <AlertCircle className="w-4 h-4" /> Weaknesses
          </h4>
          <ul className="space-y-1.5">
            {reviewResult.weaknesses.map((w, i) => (
              <li key={i} className="text-sm text-foreground/60 flex gap-2">
                <span className="text-destructive mt-0.5">•</span>{w}
              </li>
            ))}
          </ul>
        </div>
      )}

      {reviewResult.priority_improvements && reviewResult.priority_improvements.length > 0 && (
        <div className="bg-accent/5 border border-accent/20 rounded-lg p-4">
          <h4 className="text-sm font-medium mb-2 text-accent">Top Priority Improvements</h4>
          <ol className="space-y-1.5">
            {reviewResult.priority_improvements.map((p, i) => (
              <li key={i} className="text-sm text-foreground/60 flex gap-2">
                <span className="font-medium text-accent">{i + 1}.</span>{p}
              </li>
            ))}
          </ol>
        </div>
      )}

      <Button onClick={onPolish} disabled={polishing} className="w-full">
        {polishing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Sparkles className="w-4 h-4 mr-2" />}
        {polishing ? 'Polishing...' : 'Apply Polish Based on Review'}
      </Button>
    </div>
  );
}