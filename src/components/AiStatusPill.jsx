import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Globe, Loader2, Sparkles } from 'lucide-react';
import { badgeVariants } from '@/components/ui/badge';
import { refreshAIStatus } from '@/lib/ai';
import AiSetupDialog from '@/components/AiSetupDialog';

/** Clickable status + setup entry point for local Ollama and optional hosted AI. */
export default function AiStatusPill() {
  const [status, setStatus] = useState(null);
  const [open, setOpen] = useState(false);

  const refresh = useCallback(async () => {
    const next = await refreshAIStatus();
    setStatus(next);
    return next;
  }, []);

  useEffect(() => {
    let alive = true;
    refreshAIStatus().then((next) => { if (alive) setStatus(next); });
    const timer = setInterval(() => {
      refreshAIStatus().then((next) => { if (alive) setStatus(next); });
    }, 120000);
    return () => { alive = false; clearInterval(timer); };
  }, []);

  let label = 'Checking AI…';
  let detail = 'Check your local Ollama model or optional hosted provider.';
  let tone = 'text-foreground/45';
  let Icon = Loader2;

  if (status) {
    if (status.provider === 'ollama') {
      if (!status.reachable || status.modelInstalled === false) {
        label = 'Ollama offline';
        detail = status.message || 'The selected local model cannot be reached.';
        tone = 'text-amber-700 border-amber-300 bg-amber-50';
        Icon = AlertTriangle;
      } else {
        label = `Ollama · ${status.model || 'local'}`;
        detail = 'Local model selected. Calls go directly from this browser to your computer.';
        tone = 'text-green-700 border-green-300 bg-green-50';
        Icon = CheckCircle2;
      }
    } else if (status.mode === 'hosted' && status.configured) {
      const providerName = status.provider === 'nararouter' ? 'NaraRouter' : status.provider || 'Hosted';
      label = `${providerName} · capped by provider`;
      detail = status.grounding
        ? 'Gemini grounding is available when a Google Search-grounded request succeeds.'
        : 'Hosted provider selected. Its own pricing, quotas, and errors apply.';
      tone = 'text-green-700 border-green-300 bg-green-50';
      Icon = status.grounding ? Globe : CheckCircle2;
    } else if (status.mode === 'hosted') {
      label = 'Hosted AI unavailable';
      detail = status.message || 'No hosted provider key is configured on this deployment.';
      tone = 'text-amber-700 border-amber-300 bg-amber-50';
      Icon = AlertTriangle;
    } else {
      label = 'AI setup · Demo';
      detail = 'Demo output is clearly labeled. Connect local Ollama to generate real output.';
      tone = 'text-amber-700 border-amber-300 bg-amber-50';
      Icon = Sparkles;
    }
  }

  return (
    <>
      <button
        type="button"
        className={`${badgeVariants({ variant: 'outline' })} ${tone} cursor-pointer gap-1.5 whitespace-nowrap hover:opacity-80`}
        title={detail}
        aria-label={`AI status: ${label}. Open AI setup.`}
        onClick={() => setOpen(true)}
      >
        <Icon className={`h-3 w-3 ${!status ? 'animate-spin' : ''}`} />
        {label}
      </button>
      <AiSetupDialog open={open} onOpenChange={setOpen} onStatusChange={refresh} />
    </>
  );
}
