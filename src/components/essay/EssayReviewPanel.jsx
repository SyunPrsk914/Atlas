import { Button } from '@/components/ui/button';
import {
  ClipboardCheck, CheckCircle2, AlertCircle, Sparkles, Loader2, Bot, Quote,
} from 'lucide-react';

const tone = (score) => (score >= 7 ? 'text-green-600' : score >= 5 ? 'text-accent' : 'text-destructive');

function MiniScore({ label, score }) {
  if (score === undefined || score === null) return null;
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-foreground/40">{label}</span>
      <div className="flex gap-0.5">
        {Array.from({ length: 10 }, (_, i) => (
          <div key={i} className={`w-2.5 h-1.5 rounded-full ${i < Math.round(score) ? 'bg-accent' : 'bg-muted'}`} />
        ))}
      </div>
      <span className={`text-xs font-medium ${tone(score)}`}>{score}/10</span>
    </div>
  );
}

export default function EssayReviewPanel({ reviewResult, onPolish, polishing, cachedAt }) {
  if (!reviewResult) return null;

  const overall = Number(reviewResult.overall_score) || 0;

  return (
    <div className="bg-card border border-border rounded-xl p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ClipboardCheck className="w-4 h-4 text-foreground/50" />
          <span className="font-display text-lg font-semibold">Admissions Review</span>
          {cachedAt && (
            <span className="text-[11px] text-foreground/35 ml-2">cached {new Date(cachedAt).toLocaleDateString()} — stays when you navigate</span>
          )}
        </div>
        <div className="flex items-baseline gap-1.5">
          <span className="text-sm text-foreground/40">Score</span>
          <span className={`font-display text-2xl font-bold ${tone(overall)}`}>{overall}/10</span>
        </div>
      </div>

      {reviewResult.sounds_like_ai && (
        <div className="bg-destructive/5 border border-destructive/20 rounded-lg p-3.5 flex items-start gap-2.5">
          <Bot className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-destructive">This reads as AI-written</p>
            {reviewResult.ai_patterns_detected?.length > 0 && (
              <ul className="text-xs text-destructive/80 mt-1.5 space-y-0.5">
                {reviewResult.ai_patterns_detected.map((p, i) => <li key={i}>• {p}</li>)}
              </ul>
            )}
          </div>
        </div>
      )}

      {reviewResult.over_limit && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3.5 flex items-start gap-2.5">
          <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
          <p className="text-xs text-red-700">
            {reviewResult.word_count} against a limit of {reviewResult.limit}. The portal will reject this — cut it
            before submitting.
          </p>
        </div>
      )}

      <div className="grid sm:grid-cols-2 gap-2">
        <MiniScore label="Prompt alignment" score={reviewResult.prompt_alignment_score} />
        <MiniScore label="Authenticity" score={reviewResult.authenticity_score} />
        <MiniScore label="Specificity" score={reviewResult.specificity_score} />
        <MiniScore label="Structure" score={reviewResult.structure_score} />
        <MiniScore label="Voice" score={reviewResult.voice_score} />
      </div>

      {reviewResult.quoted_evidence?.length > 0 && (
        <div>
          <h4 className="text-sm font-medium flex items-center gap-1.5 mb-2 text-foreground/60">
            <Quote className="w-3.5 h-3.5" /> Exact phrases flagged
          </h4>
          <ul className="space-y-1">
            {reviewResult.quoted_evidence.map((q, i) => (
              <li key={i} className="text-xs text-foreground/55 font-mono bg-muted/50 rounded px-2 py-1">{q}</li>
            ))}
          </ul>
        </div>
      )}

      {reviewResult.summary && (
        <p className="text-sm text-foreground/60 leading-relaxed italic">“{reviewResult.summary}”</p>
      )}

      {reviewResult.strengths?.length > 0 && (
        <div>
          <h4 className="text-sm font-medium flex items-center gap-1.5 mb-2 text-green-600">
            <CheckCircle2 className="w-4 h-4" /> What works — protect this
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

      {reviewResult.weaknesses?.length > 0 && (
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

      {reviewResult.priority_improvements?.length > 0 && (
        <div className="bg-accent/5 border border-accent/20 rounded-lg p-4">
          <h4 className="text-sm font-medium mb-2 text-accent">Do these first</h4>
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
        {polishing ? 'Editing…' : 'Apply these edits to the draft'}
      </Button>
    </div>
  );
}