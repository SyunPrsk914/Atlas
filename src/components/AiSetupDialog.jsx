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
import {
  getAIMode, getModelOverride, providerLabel, setAIMode, setModelOverride,
} from '@/api/aiProvider';

const DEFAULT_MODEL = '__deployment_default__';

/** What the setup panel says for each provider the server can report. */
const NARAROUTER_COPY = {
  short: 'NaraRouter',
  title: 'NaraRouter',
  blurb: (
    <>
      OpenAI-compatible gateway at <code>router.bynara.id/v1</code>. Requests go from this
      deployment&apos;s server function to the gateway — never from your browser with a key in it.
    </>
  ),
  notConnected: 'No AI key is configured on this deployment, so Atlas is returning labeled demo output. Set NARAROUTER_API_KEY (Vercel → Environment Variables, then redeploy) to turn on real generation.',
  modelHelpOk: 'This list is read from the provider with your deployment key, so it shows only the aliases your plan can actually call.',
  steps: [
    <>Create a key at <a className="underline inline-flex items-center gap-1" href="https://router.bynara.id/keys" target="_blank" rel="noreferrer">router.bynara.id/keys<ExternalLink className="h-3 w-3" /></a> — keys start with <code>sk-nry-</code> and the secret is shown only once.</>,
    <>Add <code>NARAROUTER_API_KEY</code> to the deployment (Vercel → Project → Settings → Environment Variables). For local development put it in <code>.env.local</code>, which is git-ignored.</>,
    <>Optionally set <code>NARAROUTER_MODEL</code> to the alias you want by default; otherwise Atlas uses <code>agnes-3-flash</code>.</>,
    <>Redeploy, then press “Re-check” above and select NaraRouter.</>,
  ],
};

const OLLAMA_COPY = {
  short: 'Ollama',
  title: 'Ollama (local)',
  blurb: (
    <>
      A model that runs on this computer through Ollama. The Atlas server calls Ollama at
      <code> OLLAMA_BASE_URL</code> (default <code>http://127.0.0.1:11434</code>); the browser never
      talks to it, and no API key is used.
    </>
  ),
  notConnected: 'Ollama is selected but it is not reachable. Start Ollama on this computer, then press Re-check.',
  modelHelpOk: 'These are the models installed in Ollama on this computer (the same list as `ollama list`). A model marked “reasons first” writes a chain of thought before it answers, which is where the depth of an essay review or a research report comes from.',
  steps: [
    <>Install Ollama from <a className="underline inline-flex items-center gap-1" href="https://ollama.com/download" target="_blank" rel="noreferrer">ollama.com/download<ExternalLink className="h-3 w-3" /></a> and open it. It keeps running in the background.</>,
    <>In a terminal run <code>ollama pull qwen3:8b</code> (a reasoning model — the recommended one; bigger models need more memory).</>,
    <>In <code>.env.local</code> (git-ignored) add <code>LLM_PROVIDER=ollama</code> and <code>OLLAMA_MODEL=qwen3:8b</code>. Optional: <code>OLLAMA_NUM_CTX</code> (context window, default 16384 — Ollama reserves the whole window in video memory on every call, so raise it only as far as this machine can afford, and lower it to 8192 if a call reports out of memory), <code>OLLAMA_THINK</code> (on | off | auto, default on), <code>OLLAMA_THINK_BUDGET</code> (output room for the reasoning trace, default 8192).</>,
    <>Restart <code>npm run dev</code>, press “Re-check” here, then choose Ollama.</>,
  ],
  note: 'Runs on this computer: no key and no provider quota. Prompts go to your local Ollama, not to NaraRouter, unless you pick an Ollama cloud model. A reasoning model is asked to think on every call, its trace is kept out of the answer, and its output room is enlarged to fit both — so an answer is never cut short by the thinking that produced it. Speed depends on your hardware, so a long document can take many minutes. A prompt larger than the context window is refused with a message; Atlas never cuts it silently.',
};

/** Copy for the provider the server reports. Unknown providers get neutral wording. */
function copyFor(provider) {
  if (!provider || provider === 'nararouter') return NARAROUTER_COPY;
  if (provider === 'ollama') return OLLAMA_COPY;
  const label = providerLabel(provider);
  return {
    short: label,
    title: label,
    blurb: <>Connected through this deployment&apos;s server. The key stays on the server.</>,
    notConnected: `${label} is selected but it is not connected. Check its key and the deployment environment variables.`,
    modelHelpOk: 'This provider does not expose a model list Atlas can read, so the deployment default is used.',
    steps: [<>Set the provider&apos;s key on the deployment (see DEPLOYMENT.md), redeploy, then press “Re-check”.</>],
  };
}

const formatCount = (value) => (Number.isFinite(Number(value)) ? Number(value).toLocaleString('en-US') : '');

/**
 * What the local model does with reasoning, read from the server's own probe of
 * Ollama — never guessed here.
 *
 * This is the only place a local applicant can see whether the model they
 * installed is actually being asked to think, so it states the request Atlas
 * sends, what the model said it supports, and the two settings that decide the
 * depth of an answer (the context window and the trace budget).
 */
export function OllamaReasoning({ status }) {
  const thinking = status?.thinking;
  if (!thinking) return null;
  const model = status?.model || 'this model';
  const context = status?.context || {};

  let headline;
  let detail;
  if (thinking.supported === false) {
    headline = `${model} has no reasoning mode`;
    detail = 'Atlas asks nothing and uses the answer as written. A model marked “reasons first” (qwen3:8b, for example) writes a chain of thought before it answers, which is where the depth of a review or a research report comes from.';
  } else if (thinking.on) {
    headline = `Reasoning is on for ${model}`;
    detail = `Atlas asks it to think on every call, keeps the trace out of the answer, and reserves ${formatCount(thinking.think_budget)} output tokens for it so the answer is never cut short by the thinking that produced it.`;
  } else {
    headline = `Reasoning is off for ${model}`;
    detail = `OLLAMA_THINK is set to ${thinking.requested === null ? 'the model default' : String(thinking.requested)}, so answers come back faster and shallower. Set OLLAMA_THINK=on in .env.local and restart to restore the depth.`;
  }

  return (
    <div className="rounded-md border border-border bg-muted/20 p-3 text-[11px] text-foreground/70 space-y-1.5">
      <p className="font-medium text-foreground/85">{headline}</p>
      <p>{detail}</p>
      <p className="text-foreground/55">
        Context window {formatCount(context.requested) || 'unknown'} tokens
        {context.model_max ? ` · this model's own limit is ${formatCount(context.model_max)}` : ''}
        {context.clamped ? ' · Ollama will use the smaller number' : ''}
        {status?.timeout_ms ? ` · Atlas waits up to ${Math.round(Number(status.timeout_ms) / 60000)} minutes for one answer` : ''}.
      </p>
      {(Array.isArray(status?.notes) ? status.notes : []).map((note) => (
        <p key={note} className="text-amber-800">{note}</p>
      ))}
    </div>
  );
}

/**
 * AI setup: one provider is active for the deployment (NaraRouter by default, or a
 * local Ollama when the server is set to LLM_PROVIDER=ollama), plus demo mode.
 *
 * Keys are server-side environment variables: they are never typed into this
 * dialog and never reach the browser. This dialog shows honestly whether the
 * deployment's provider is connected, lets the applicant pick a model the
 * provider actually has, and lets them choose demo mode.
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
      // A model saved for another provider (or an alias the key no longer has)
      // would fail every call. When the provider's list is readable and does
      // not contain the saved model, go back to the deployment default and say so.
      const saved = getModelOverride();
      const listed = Array.isArray(models?.models) ? models.models : [];
      if (saved && models?.ok && models?.listable && listed.length && !listed.includes(saved)) {
        setModelOverride('');
        setModel(DEFAULT_MODEL);
        toast.warning('Saved model is no longer available', {
          description: `“${saved}” is not in this provider's list, so Atlas uses the deployment default.`,
        });
      } else if (models?.default_model && !saved) {
        setModel(DEFAULT_MODEL);
      }
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

  const provider = status?.provider || modelList?.provider || null;
  const copy = copyFor(provider);
  const isOllama = provider === 'ollama';
  const configured = !!status?.configured;
  const entitled = Array.isArray(modelList?.models) ? modelList.models : [];
  const reasoningModels = Array.isArray(modelList?.thinking_models) ? modelList.thinking_models : [];

  const activate = async (mode) => {
    try {
      setAIMode(mode);
      setActiveMode(mode);
      await onStatusChange?.();
      toast.success(mode === 'hosted' ? `${copy.short} selected` : 'Demo mode selected', {
        description: mode === 'hosted'
          ? `Every AI action now goes through ${copy.short}. Atlas sends calls one at a time, in the order you clicked them.`
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
        : isOllama
          ? 'Atlas runs exactly this model. If Ollama does not have it, the error names the command to pull it.'
          : 'If your plan stops entitling this alias, Atlas falls back to the deployment default instead of failing.',
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5" /> AI setup
          </DialogTitle>
          <DialogDescription>
            Atlas uses one AI provider for this deployment: NaraRouter by default, or a local Ollama
            when the server is set to <code>LLM_PROVIDER=ollama</code>. Keys are server-side environment
            variables, so they are never typed into this page and never reach your browser. Atlas adds
            no quota of its own; the provider&apos;s own limits apply.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <section className="rounded-lg border border-border p-4 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold">{copy.title}</h3>
                <p className="text-xs text-foreground/55 mt-1">{copy.blurb}</p>
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
                    Connected: <span className="font-medium">{providerLabel(provider)}</span>
                    {status?.model || modelList?.default_model ? <> · default model <code>{status.model || modelList.default_model}</code></> : null}
                    {entitled.length ? <> · {entitled.length} model(s) available</> : null}
                  </span>
                </>
              ) : (
                <>
                  <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
                  <span className="text-amber-900">
                    {status?.message || copy.notConnected}
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
                      <SelectItem key={alias} value={alias}>
                        {alias}{reasoningModels.includes(alias) ? ' · reasons first' : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-foreground/45">
                  {modelList?.listable
                    ? copy.modelHelpOk
                    : (modelList?.message || 'This provider does not expose a model list Atlas can read, so the deployment default is used.')}
                </p>
                {isOllama && <OllamaReasoning status={status} />}
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              <Button type="button" onClick={() => activate('hosted')} disabled={!configured} variant={activeMode === 'hosted' ? 'secondary' : 'default'}>
                {activeMode === 'hosted' ? `${copy.short} selected` : `Use ${copy.short}`}
              </Button>
              <Button type="button" variant="ghost" onClick={load} disabled={loading}>
                <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${loading ? 'animate-spin' : ''}`} /> Re-check
              </Button>
            </div>
            {!configured && (
              <p className="text-[11px] text-foreground/45">
                “Use {copy.short}” is disabled until this deployment can answer — selecting it without a working
                provider would turn every AI action into an error instead of labeled demo output.
              </p>
            )}
          </section>

          <section className="rounded-lg border border-border p-4 space-y-2">
            <h3 className="text-sm font-semibold">
              {isOllama ? 'Setting up Ollama on this computer' : 'Setting the key (once, on the deployment)'}
            </h3>
            <ol className="text-xs text-foreground/65 space-y-1.5 list-decimal pl-4">
              {copy.steps.map((step, index) => <li key={index}>{step}</li>)}
            </ol>
            {copy.note && (
              <p className="rounded-md border border-border bg-muted/30 p-3 text-xs text-foreground/70">{copy.note}</p>
            )}
            {(provider === 'nararouter' || !provider) && (
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
            )}
          </section>

          <div className="flex items-center justify-between gap-3 border-t border-border pt-4">
            <p className="text-xs text-foreground/45">
              Current mode: <span className="font-medium text-foreground">{activeMode === 'hosted' ? copy.short : 'Labeled demo'}</span>
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
