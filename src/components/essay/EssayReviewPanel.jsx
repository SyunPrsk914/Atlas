import { Button } from '@/components/ui/button';
import {
  ClipboardCheck, CheckCircle2, AlertCircle, Sparkles, Loader2, Bot, Quote,
  Ruler, TrendingUp, TrendingDown, Minus, Target,
} from 'lucide-react';
import { ESSAY_REVIEW_DIMENSIONS } from '@/lib/essayCraft';
import { formatLimit } from '@/lib/essayScope';

const tone = (score) => (score >= 9 ? 'text-green-700' : score >= 7 ? 'text-green-600' : score >= 5 ? 'text-accent' : 'text-destructive');

function MiniScore({ label, score, hint }) {
  if (score === undefined || score === null || Number.isNaN(Number(score))) return null;
  const value = Number(score);
  return (
    <div className="flex items-start gap-2" title={hint}>
      <span className="text-xs text-foreground/40 w-28 shrink-0 pt-0.5">{label}</span>
      <div className="flex gap-0.5 pt-1.5">
        {Array.from({ length: 10 }, (_, i) => (
          <div key={i} className={`w-2.5 h-1.5 rounded-full ${i < Math.round(value) ? 'bg-accent' : 'bg-muted'}`} />
        ))}
      </div>
      <span className={`text-xs font-medium pt-0.5 ${tone(value)}`}>{value}/10</span>
    </div>
  );
}

/** Overall score, with the change since the previous review of this essay. */
function ScoreHeading({ score, previousScore }) {
  const delta = Number.isFinite(Number(score)) && Number.isFinite(Number(previousScore)) && previousScore > 0
    ? Number(score) - Number(previousScore)
    : null;
  const rounded = delta === null ? null : Math.round(delta * 10) / 10;
  const DeltaIcon = rounded === null ? null : rounded > 0 ? TrendingUp : rounded < 0 ? TrendingDown : Minus;
  return (
    <div className="flex items-baseline gap-1.5 flex-wrap">
      <span className="text-sm text-foreground/40">Score</span>
      <span className={`font-display text-2xl font-bold ${tone(score)}`}>{score}/10</span>
      {rounded !== null && (
        <span
          className={`inline-flex items-center gap-1 text-xs font-medium ${
            rounded > 0 ? 'text-green-700' : rounded < 0 ? 'text-red-600' : 'text-foreground/40'
          }`}
          title="Change since the previous review of this same essay"
        >
          {DeltaIcon && <DeltaIcon className="w-3.5 h-3.5" />}
          {rounded > 0 ? `+${rounded}` : rounded} since the last review
        </span>
      )}
    </div>
  );
}

export default function EssayReviewPanel({ reviewResult, onPolish, polishing, cachedAt, previousScore, onReReview, reReviewing }) {
  if (!reviewResult) return null;

  const overall = Number(reviewResult.overall_score) || 0;
  // Optional ideas from the review. They contributed to no score above, so they
  // are rendered apart from the findings and labelled as options.
  const optionalAdditions = (reviewResult.optional_additions || [])
    .map((item) => (typeof item === 'string' ? { suggestion: item } : item))
    .filter((item) => item && String(item.suggestion || '').trim());
  const perDimension = Array.isArray(reviewResult.per_dimension) ? reviewResult.per_dimension : [];
  const unit = reviewResult.unit || 'words';

  return (
    <div className="bg-card border border-border rounded-xl p-5 space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <ClipboardCheck className="w-4 h-4 text-foreground/50" />
          <span className="font-display text-lg font-semibold">Admissions Review</span>
          {cachedAt && (
            <span className="text-[11px] text-foreground/35 ml-2">cached {new Date(cachedAt).toLocaleDateString()} — stays when you navigate</span>
          )}
        </div>
        <ScoreHeading score={overall} previousScore={previousScore} />
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
            {Number(reviewResult.word_count).toLocaleString()} against a limit of {Number(reviewResult.limit).toLocaleString()} {formatLimit(unit)}. The portal will reject this — cut it
            before submitting.
          </p>
        </div>
      )}

      {reviewResult.under_target && !reviewResult.over_limit && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3.5 flex items-start gap-2.5">
          <Ruler className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
          <p className="text-xs text-amber-800">
            {reviewResult.length_message
              || `${Number(reviewResult.word_count).toLocaleString()} of ${Number(reviewResult.limit).toLocaleString()} ${formatLimit(unit)} — under the target band. A reader treats unused space as an unfinished draft.`}
          </p>
        </div>
      )}

      <div className="grid sm:grid-cols-2 gap-2">
        {ESSAY_REVIEW_DIMENSIONS.map((dimension) => (
          <MiniScore
            key={dimension.key}
            label={dimension.label}
            score={reviewResult[dimension.field]}
            hint={dimension.question}
          />
        ))}
      </div>

      {perDimension.length > 0 && (
        <div className="bg-accent/5 border border-accent/20 rounded-lg p-4">
          <h4 className="text-sm font-medium mb-2.5 text-accent inline-flex items-center gap-1.5">
            <Target className="w-4 h-4" /> What would make each one a 10
          </h4>
          <ul className="space-y-2.5">
            {perDimension
              .filter((item) => item && (item.how_to_reach_ten || item.evidence))
              .map((item, i) => {
                const known = ESSAY_REVIEW_DIMENSIONS.find(
                  (d) => d.key === String(item.dimension || '').toLowerCase().replace(/\s+/g, '_') || d.label.toLowerCase() === String(item.dimension || '').toLowerCase(),
                );
                return (
                  <li key={i} className="text-sm">
                    <span className="font-medium text-foreground/70">{known?.label || item.dimension || 'Dimension'}:</span>{' '}
                    <span className="text-foreground/60">{item.how_to_reach_ten || item.evidence}</span>
                  </li>
                );
              })}
          </ul>
        </div>
      )}

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

      {optionalAdditions.length > 0 && (
        <div className="bg-muted/30 border border-border/60 rounded-lg p-4">
          <h4 className="text-sm font-medium mb-1">Ideas you could consider</h4>
          <p className="text-xs text-foreground/40 mb-2.5">
            These changed no score above, and skipping every one is a fine outcome.
            An admissions officer never sees your profile or your documents — they
            see this page — so nothing here is something you were expected to include.
          </p>
          <ul className="space-y-2">
            {optionalAdditions.map((item, i) => (
              <li key={i} className="text-sm text-foreground/60">
                <span className="block">{item.suggestion}</span>
                {(item.where || item.why_it_might_help) && (
                  <span className="block text-xs text-foreground/35 mt-0.5">
                    {[item.where ? `where: ${item.where}` : '', item.why_it_might_help || ''].filter(Boolean).join(' · ')}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex items-center gap-2 flex-wrap pt-1">
        <Button onClick={onPolish} disabled={polishing || reReviewing} className="flex-1 min-w-52">
          {polishing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Sparkles className="w-4 h-4 mr-2" />}
          {polishing ? 'Editing…' : 'Apply these edits to the draft'}
        </Button>
        {onReReview && (
          <Button onClick={onReReview} disabled={polishing || reReviewing} variant="outline">
            {reReviewing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <ClipboardCheck className="w-4 h-4 mr-2" />}
            {reReviewing ? 'Scoring…' : 'Re-score this draft'}
          </Button>
        )}
      </div>
      <p className="text-[11px] text-foreground/40 -mt-1">
        Edits are surgical: the editor keeps your story and your wording wherever it can, and shows you every word it
        touched before you decide.
      </p>
    </div>
  );
}
