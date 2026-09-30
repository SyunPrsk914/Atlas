import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import {
  CheckCircle2, AlertTriangle, Loader2, Globe, Copy,
} from 'lucide-react';
import { refreshAIStatus, getAIStatus } from '@/lib/ai';

/**
 * Header pill that answers "is the AI actually connected?".
 *
 * Previously the only signal was a failure toast after you had already clicked
 * through a 60-second generation. This polls a zero-cost /api/status endpoint
 * once on mount, so a missing key or an unreachable function is visible before
 * you waste a click.
 */
export default function AiStatusPill() {
  const [status, setStatus] = useState(getAIStatus() || null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let alive = true;
    refreshAIStatus().then((s) => { if (alive) setStatus(s); });
    const timer = setInterval(() => {
      refreshAIStatus().then((s) => { if (alive) setStatus(s); });
    }, 120000);
    return () => { alive = false; clearInterval(timer); };
  }, []);

  if (!status) {
    return (
      <Badge variant="outline" className="gap-1.5 text-foreground/40">
        <Loader2 className="w-3 h-3 animate-spin" /> checking AI…
      </Badge>
    );
  }

  if (!status.reachable) {
    return (
      <Badge
        variant="outline"
        className="gap-1.5 text-amber-700 border-amber-300 bg-amber-50 cursor-help"
        title={status.message}
        onClick={() => toast.error('AI endpoint not reachable', { description: status.message })}
      >
        <AlertTriangle className="w-3 h-3" />
        AI offline
        <Copy
          className="w-3 h-3 ml-0.5 opacity-50"
          onClick={(e) => { e.stopPropagation(); navigator.clipboard?.writeText(status.message || ''); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
        />
      </Badge>
    );
  }

  if (!status.configured) {
    return (
      <Badge
        variant="outline"
        className="text-amber-700 border-amber-300 bg-amber-50 cursor-help"
        title="No provider key is set on the server. Add GEMINI_API_KEY (recommended — it enables live web grounding) in Vercel → Environment Variables. See DEPLOYMENT.md part 2."
        onClick={() => toast('No AI provider connected', {
          description: 'Add GEMINI_API_KEY (recommended, enables live web research), OPENAI_API_KEY, or ANTHROPIC_API_KEY to your Vercel environment variables, then redeploy. See DEPLOYMENT.md, Part 2.',
          duration: 12000,
        })}
      >
        <AlertTriangle className="w-3 h-3" />
        {copied ? 'copied' : 'Demo AI — no key set'}
      </Badge>
    );
  }

  return (
    <Badge
      variant="outline"
      className="gap-1.5 text-green-700 border-green-300 bg-green-50 cursor-help"
      title={
        status.grounding
          ? 'Live web grounding is available — university research will use real sources.'
          : `${status.provider} is connected. Live web grounding is Gemini-only; university research will use the model's own knowledge.`
      }
    >
      <CheckCircle2 className="w-3 h-3" />
      {status.provider}
      {status.grounding && <Globe className="w-3 h-3" />}
    </Badge>
  );
}
