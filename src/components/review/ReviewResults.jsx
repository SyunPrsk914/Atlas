import { CheckCircle2, XCircle, Lightbulb, AlertTriangle, Gauge } from 'lucide-react';
import ReviewSection from '@/components/review/ReviewSection';

function getProbColor(p) {
  if (p < 10) return { text: 'text-red-600', bar: 'bg-red-500' };
  if (p < 25) return { text: 'text-orange-500', bar: 'bg-orange-500' };
  if (p < 50) return { text: 'text-amber-500', bar: 'bg-amber-500' };
  return { text: 'text-green-600', bar: 'bg-green-500' };
}

function getScoreColor(score) {
  if (score <= 3) return 'bg-red-500';
  if (score <= 5) return 'bg-orange-400';
  if (score <= 7) return 'bg-amber-400';
  return 'bg-green-500';
}

const verdictStyles = {
  'Hard Reach': 'bg-red-50 text-red-700 border-red-200',
  Reach: 'bg-orange-50 text-orange-700 border-orange-200',
  Target: 'bg-amber-50 text-amber-700 border-amber-200',
  Likely: 'bg-green-50 text-green-700 border-green-200',
  Safety: 'bg-green-100 text-green-800 border-green-300',
};

function ResultList({ items, color }) {
  return (
    <ul className="space-y-2">
      {items.map((item, index) => (
        <li key={`${index}-${item}`} className="text-sm text-foreground/60 flex gap-2.5">
          <span className={`${color} shrink-0`}>•</span>
          {item}
        </li>
      ))}
    </ul>
  );
}

export default function ReviewResults({ result, cachedAt }) {
  if (!result) return null;

  const pct = Math.round(result.acceptance_probability || 0);
  const colors = getProbColor(pct);
  const verdictKey = (result.verdict || '').trim();

  return (
    <div className="space-y-3">
      <ReviewSection
        title="Acceptance outlook"
        detail={`${pct}% · ${result.verdict || 'No verdict'}`}
        leading={<Gauge className="w-4 h-4 text-foreground/45" />}
      >
        <div className="flex items-start justify-between gap-6">
          <div>
            <p className="text-xs text-foreground/50 mb-1">Estimated acceptance probability</p>
            <span className={`font-display text-5xl font-bold ${colors.text}`}>{pct}%</span>
            {cachedAt && (
              <p className="text-[11px] text-foreground/40 mt-1">Cached {new Date(cachedAt).toLocaleString()} — stays when you navigate away</p>
            )}
          </div>
          <div className="text-right">
            <p className="text-xs text-foreground/50 mb-1.5">Verdict</p>
            <span className={`inline-block px-3.5 py-1.5 rounded-lg border text-sm font-medium ${verdictStyles[verdictKey] || 'bg-muted text-foreground/60 border-border'}`}>
              {result.verdict || '—'}
            </span>
          </div>
        </div>
        <div className="mt-4 h-3 bg-muted rounded-full overflow-hidden">
          <div className={`h-full ${colors.bar} rounded-full transition-all duration-1000`} style={{ width: `${Math.min(pct, 100)}%` }} />
        </div>
        <p className="text-[11px] text-foreground/35 mt-2">
          This is an AI estimate against the published admitted profile. Most qualified applicants are still rejected. Use it to prioritize fixes, not as a guarantee.
        </p>
      </ReviewSection>

      {result.dimensions?.map((dimension, index) => (
        <ReviewSection
          key={`${dimension.name}-${index}`}
          title={dimension.name}
          detail={`${dimension.score}/10`}
          defaultOpen={index === 0}
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-foreground/40">Dimension score</span>
            <span className="font-display text-lg font-semibold">{dimension.score}<span className="text-sm text-foreground/30">/10</span></span>
          </div>
          <div className="h-2 bg-muted rounded-full overflow-hidden mb-3">
            <div className={`h-full ${getScoreColor(dimension.score)} rounded-full transition-all duration-700`} style={{ width: `${Math.max(0, Math.min(100, Number(dimension.score) * 10))}%` }} />
          </div>
          <p className="text-sm text-foreground/60 leading-relaxed">{dimension.assessment}</p>
        </ReviewSection>
      ))}

      {result.key_strengths?.length > 0 && (
        <ReviewSection
          title="Key strengths"
          detail={`${result.key_strengths.length} findings`}
          leading={<CheckCircle2 className="w-4 h-4 text-green-500" />}
        >
          <ResultList items={result.key_strengths} color="text-green-500" />
        </ReviewSection>
      )}

      {result.key_weaknesses?.length > 0 && (
        <ReviewSection
          title="Key weaknesses"
          detail={`${result.key_weaknesses.length} findings`}
          leading={<XCircle className="w-4 h-4 text-red-500" />}
        >
          <ResultList items={result.key_weaknesses} color="text-red-500" />
        </ReviewSection>
      )}

      {result.what_would_help?.length > 0 && (
        <ReviewSection
          title="What would improve the application"
          detail={`${result.what_would_help.length} ideas`}
          leading={<Lightbulb className="w-4 h-4 text-accent" />}
        >
          <ResultList items={result.what_would_help} color="text-accent" />
        </ReviewSection>
      )}

      {result.gaps?.length > 0 && (
        <ReviewSection title="Gaps to check" detail={`${result.gaps.length} items`}>
          <ResultList items={result.gaps} color="text-amber-600" />
        </ReviewSection>
      )}

      {result.summary && (
        <ReviewSection
          title="Overall assessment"
          leading={<AlertTriangle className="w-4 h-4 text-foreground/40" />}
        >
          <p className="text-sm text-foreground/60 leading-relaxed">{result.summary}</p>
        </ReviewSection>
      )}
    </div>
  );
}