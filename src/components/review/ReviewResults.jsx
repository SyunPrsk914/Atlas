import { CheckCircle2, XCircle, Lightbulb, AlertTriangle } from 'lucide-react';

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
  'Reach': 'bg-orange-50 text-orange-700 border-orange-200',
  'Target': 'bg-amber-50 text-amber-700 border-amber-200',
  'Likely': 'bg-green-50 text-green-700 border-green-200',
  'Safety': 'bg-green-100 text-green-800 border-green-300',
};

export default function ReviewResults({ result, cachedAt }) {
  if (!result) return null;

  const pct = Math.round(result.acceptance_probability || 0);
  const colors = getProbColor(pct);
  const verdictKey = (result.verdict || '').trim();

  return (
    <div className="space-y-5">
      {/* Probability + Verdict */}
      <div className="bg-card border border-border rounded-xl p-6">
        <div className="flex items-start justify-between gap-6">
          <div>
            <p className="text-sm text-foreground/50 mb-1">Acceptance Probability</p>
            <span className={`font-display text-5xl font-bold ${colors.text}`}>{pct}%</span>
            {cachedAt && (
              <p className="text-[11px] text-foreground/40 mt-1">Cached {new Date(cachedAt).toLocaleString()} — stays when you navigate away</p>
            )}
          </div>
          <div className="text-right">
            <p className="text-sm text-foreground/50 mb-1.5">Verdict</p>
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
      </div>

      {/* Dimensions */}
      {result.dimensions && result.dimensions.length > 0 && (
        <div className="space-y-3">
          {result.dimensions.map((dim, i) => (
            <div key={i} className="bg-card border border-border rounded-xl p-5">
              <div className="flex items-center justify-between mb-2">
                <span className="font-medium text-sm">{dim.name}</span>
                <span className="font-display text-lg font-semibold">{dim.score}<span className="text-sm text-foreground/30">/10</span></span>
              </div>
              <div className="h-2 bg-muted rounded-full overflow-hidden mb-3">
                <div className={`h-full ${getScoreColor(dim.score)} rounded-full transition-all duration-700`} style={{ width: `${dim.score * 10}%` }} />
              </div>
              <p className="text-sm text-foreground/60 leading-relaxed">{dim.assessment}</p>
            </div>
          ))}
        </div>
      )}

      {/* Strengths */}
      {result.key_strengths && result.key_strengths.length > 0 && (
        <div className="bg-card border border-border rounded-xl p-5">
          <h3 className="font-medium text-sm mb-3 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-green-500" />
            Key Strengths
          </h3>
          <ul className="space-y-2">
            {result.key_strengths.map((s, i) => (
              <li key={i} className="text-sm text-foreground/60 flex gap-2.5">
                <span className="text-green-500 shrink-0">•</span>
                {s}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Weaknesses */}
      {result.key_weaknesses && result.key_weaknesses.length > 0 && (
        <div className="bg-card border border-border rounded-xl p-5">
          <h3 className="font-medium text-sm mb-3 flex items-center gap-2">
            <XCircle className="w-4 h-4 text-red-500" />
            Key Weaknesses
          </h3>
          <ul className="space-y-2">
            {result.key_weaknesses.map((w, i) => (
              <li key={i} className="text-sm text-foreground/60 flex gap-2.5">
                <span className="text-red-500 shrink-0">•</span>
                {w}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* What would help */}
      {result.what_would_help && result.what_would_help.length > 0 && (
        <div className="bg-card border border-border rounded-xl p-5">
          <h3 className="font-medium text-sm mb-3 flex items-center gap-2">
            <Lightbulb className="w-4 h-4 text-accent" />
            What Would Improve Odds
          </h3>
          <ul className="space-y-2">
            {result.what_would_help.map((h, i) => (
              <li key={i} className="text-sm text-foreground/60 flex gap-2.5">
                <span className="text-accent shrink-0">•</span>
                {h}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Summary */}
      {result.summary && (
        <div className="bg-card border border-border rounded-xl p-5">
          <h3 className="font-medium text-sm mb-3 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-foreground/40" />
            Overall Assessment
          </h3>
          <p className="text-sm text-foreground/60 leading-relaxed">{result.summary}</p>
        </div>
      )}
    </div>
  );
}