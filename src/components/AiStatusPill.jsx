import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Globe, Loader2, Sparkles } from 'lucide-react';
import { badgeVariants } from '@/components/ui/badge';
import { refreshAIStatus } from '@/lib/ai';
import AiSetupDialog from '@/components/AiSetupDialog';

/**
 * Clickable AI status + setup entry point.
 *
 * Two honest states: the configured AI provider (NaraRouter, or a local Ollama)
 * is connected, or it is not and Atlas is showing labeled demo output. It never
 * says "connected" on a deployment with no working provider.
 */
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
  let detail = 'Reading this deployment\'s AI configuration.';
  let tone = 'text-foreground/45';
  let Icon = Loader2;

  if (status) {
    const name = status.providerLabel || 'AI';
    if (status.mode === 'hosted' && status.configured) {
      label = status.model ? `${name} · ${status.model}` : name;
      detail = status.grounding
        ? 'Connected. Google Search grounding is available when a grounded request succeeds.'
        : 'Connected. Atlas sends AI calls one at a time, in the order you clicked them. The provider\'s own plan limits and errors apply.';
      tone = 'text-green-700 border-green-300 bg-green-50';
      Icon = status.grounding ? Globe : CheckCircle2;
    } else if (status.mode === 'hosted') {
      label = 'AI not connected';
      detail = status.message || 'The selected AI provider is not connected. Open AI setup for the steps.';
      tone = 'text-amber-700 border-amber-300 bg-amber-50';
      Icon = AlertTriangle;
    } else {
      label = 'AI setup · Demo';
      detail = status.configured
        ? 'Demo output is active and clearly labeled. Select your AI provider in AI setup for real generation.'
        : 'Demo output is active: no AI provider is connected yet. Open AI setup for the steps, or keep using Atlas with labeled placeholder output.';
      tone = 'text-amber-700 border-amber-300 bg-amber-50';
      Icon = Sparkles;
    }
    if (status.lastCallError) {
      detail = `Last AI call failed: ${status.lastCallError}. ${detail}`;
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
