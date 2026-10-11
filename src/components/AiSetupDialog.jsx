import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { AlertTriangle, CheckCircle2, ExternalLink, Loader2, RefreshCw, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { checkAIStatus, listAIModels } from '@/api/llmClient';
import { getAIMode, getModelOverride, setAIMode, setModelOverride, providerLabel } from '@/api/aiProvider';

const DEFAULT_MODEL = '__deployment_default__';

/**
 * AI setup: one provider, NaraRouter, plus demo mode.
 *
 * The key is a server-side environment variable — it is never typed into this
 * dialog and never reaches the browser bundle. What this dialog does is show
 * honestly whether the deployment has a key, let the applicant pick a model
 * alias their key is actually entitled to, and let them choose demo mode.
 */
export default function AiSetupDialog({ open, onOpenChange, onStatusChange }) {
  const [activeMode, setActiveMode] = useState('demo');
  const [status, setStatus] = useState(null);
  const [modelList, setModelList] = useState(null);
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const [statusResult, models] = await Promise.all([checkAIStatus(), listAIModels()]);
      setStatus(statusResult);
      setModelList(models);
      if (models?.default_model && !getModelOverride()) setModel(DEFAULT_MODEL);
    } catch (e) {
      setError(e?.message || 'Could not read the AI configuration.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    setActiveMode(getAIMode());
    setModel(getModelOverride() || DEFAULT_MODEL);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const activate = async (mode) => {
    try {
      setAIMode(mode);
      setActiveMode(mode);
      await onStatusChange?.();
      toast.success(mode === 'hosted' ? 'NaraRouter selected' : 'Demo mode selected', {
        description: mode === 'hosted'
          ? 'Every AI action now goes through NaraRouter. Atlas sends calls one at a time, in the order you clicked them.'
          : 'AI actions return clearly labeled placeholder text and nothing is saved. Switch back any time.',
      });
      if (mode === 'demo') onOpenChange(false);
    } catch (e) {
      toast.error('Could not change the AI mode', { description: e.message });
    }
  };

  const saveModel = (value) => {
    setModel(value);
    setModelOverride(value === DEFAULT_MODEL ? '' : value);
    toast.success(value === DEFAULT_MODEL ? 'Using the deployment default model' : `Model set to ${value}`, {
      description: value === DEFAULT_MODEL
        ? `Atlas will use ${modelList?.default_model || status?.model || 'the model configured on this deployment'}.`
        : 'If your plan stops entitling this alias, Atlas falls back to the deployment default instead of failing.',
    });
  };

  const configured = !!status?.configured;
  const name = providerLabel(status?.provider || modelList?.provider);
  const entitled = Array.isArray(modelList?.models) ? modelList.models : [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5" /> AI setup
          </DialogTitle>
          <DialogDescription>
            Atlas runs on NaraRouter. The API key is a server-side environment variable, so it is never
            typed into this page and never reaches your browser. Atlas adds no quota of its own; the
            provider&apos;s plan limits apply.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <section className="rounded-lg border border-border p-4 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold">NaraRouter</h3>
                <p className="text-xs text-foreground/55 mt-1">
                  OpenAI-compatible gateway at <code>router.bynara.id/v1</code>. Requests go from this
                  deployment&apos;s server function to the gateway — never from your browser with a key in it.
                </p>
              </div>
              {activeMode === 'hosted' && (
                <span className="shrink-0 inline-flex items-center gap-1 text-xs text-green-700">
                  <CheckCircle2 className="h-3.5 w-3.5" /> Selected
                </span>
              )}
            </div>

            <div className="flex items-start gap-2 rounded-md border p-3 text-xs">
              {loading ? (
                <><Loader2 className="h-4 w-4 shrink-0 animate-spin text-foreground/40" /><span className="text-foreground/60">Reading this deployment&apos;s AI configuration…</span></>
              ) : configured ? (
                <>
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-green-600" />
                  <span className="text-foreground/70">
                    Connected: <span className="font-medium">{name}</span>
                    {status?.model || modelList?.default_model ? <> · default model <code>{status.model || modelList.default_model}</code></> : null}
                    {entitled.length ? <> · {entitled.length} alias(es) your key can call</> : null}
                  </span>
                </>
              ) : (
                <>
                  <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
                  <span className="text-amber-900">
                    No AI key is configured on this deployment, so Atlas is returning labeled demo output.
                    Set <code>NARAROUTER_API_KEY</code> (Vercel → Environment Variables, then redeploy) to turn on real generation.
                  </span>
                </>
              )}
            </div>

            {error && <p className="text-xs text-destructive">{error}</p>}

            {configured && (
              <div className="space-y-1.5">
                <Label htmlFor="ai-model">Model</Label>
                <Select value={model} onValueChange={saveModel}>
                  <SelectTrigger id="ai-model" className="w-full">
                    <SelectValue placeholder="Choose a model" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={DEFAULT_MODEL}>
                      Deployment default{modelList?.default_model ? ` (${modelList.default_model})` : ''}
                    </SelectItem>
                    {entitled.map((alias) => (
                      <SelectItem key={alias} value={alias}>{alias}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-foreground/45">
                  {modelList?.listable
                    ? 'This list is read from the provider with your deployment key, so it shows only the aliases your plan can actually call.'
                    : (modelList?.message || 'This provider does not expose a model list Atlas can read, so the deployment default is used.')}
                </p>
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              <Button type="button" onClick={() => activate('hosted')} disabled={!configured} variant={activeMode === 'hosted' ? 'secondary' : 'default'}>
                {activeMode === 'hosted' ? 'NaraRouter selected' : 'Use NaraRouter'}
              </Button>
              <Button type="button" variant="ghost" onClick={load} disabled={loading}>
                <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${loading ? 'animate-spin' : ''}`} /> Re-check
              </Button>
            </div>
            {!configured && (
              <p className="text-[11px] text-foreground/45">
                “Use NaraRouter” is disabled until this deployment has a key — selecting it without one would turn
                every AI action into an error instead of labeled demo output.
              </p>
            )}
          </section>

          <section className="rounded-lg border border-border p-4 space-y-2">
            <h3 className="text-sm font-semibold">Setting the key (once, on the deployment)</h3>
            <ol className="text-xs text-foreground/65 space-y-1.5 list-decimal pl-4">
              <li>Create a key at <a className="underline inline-flex items-center gap-1" href="https://router.bynara.id/keys" target="_blank" rel="noreferrer">router.bynara.id/keys<ExternalLink className="h-3 w-3" /></a> — keys start with <code>sk-nry-</code> and the secret is shown only once.</li>
              <li>Add <code>NARAROUTER_API_KEY</code> to the deployment (Vercel → Project → Settings → Environment Variables). For local development put it in <code>.env.local</code>, which is git-ignored.</li>
              <li>Optionally set <code>NARAROUTER_MODEL</code> to the alias you want by default; otherwise Atlas uses <code>agnes-3-flash</code>.</li>
              <li>Redeploy, then press “Re-check” above and select NaraRouter.</li>
            </ol>
            <div className="space-y-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-950" role="note">
              <p>
                NaraRouter is hosted, not local. Its live pricing page currently lists 7M tokens per day and
                15 requests per minute on the Free plan, and not every public alias is callable on every plan —
                available models and limits can change. Atlas adds no quota of its own and never rewrites a real
                provider error into a success.
              </p>
              <p>
                Prompts are relayed to the gateway&apos;s upstream model provider. Its privacy policy says upstream
                retention terms apply and that the service is not directed to people under 18. Read those terms
                before sending student profiles, essays, or materials — especially data about a minor.
              </p>
              <p className="flex flex-wrap gap-x-3 gap-y-1">
                <a className="underline" href="https://router.bynara.id/docs" target="_blank" rel="noreferrer">API docs</a>
                <a className="underline" href="https://router.bynara.id/pricing" target="_blank" rel="noreferrer">Plans and limits</a>
                <a className="underline" href="https://router.bynara.id/privacy" target="_blank" rel="noreferrer">Privacy policy</a>
              </p>
            </div>
          </section>

          <div className="flex items-center justify-between gap-3 border-t border-border pt-4">
            <p className="text-xs text-foreground/45">
              Current mode: <span className="font-medium text-foreground">{activeMode === 'hosted' ? name : 'Labeled demo'}</span>
            </p>
            {activeMode !== 'demo' && (
              <Button type="button" variant="ghost" size="sm" onClick={() => activate('demo')}>
                Use demo mode
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
