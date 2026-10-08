import { useEffect, useId, useState } from 'react';
import { toast } from 'sonner';
import { AlertTriangle, CheckCircle2, Loader2, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { checkAIStatus } from '@/api/llmClient';
import {
  configureOllama,
  DEFAULT_OLLAMA_BASE_URL,
  DEFAULT_OLLAMA_MODEL,
  getAIMode,
  getOllamaConfig,
  probeOllama,
  setAIMode,
} from '@/api/ollamaClient';

export default function AiSetupDialog({ open, onOpenChange, onStatusChange }) {
  const modelListId = useId();
  const [baseUrl, setBaseUrl] = useState(DEFAULT_OLLAMA_BASE_URL);
  const [model, setModel] = useState(DEFAULT_OLLAMA_MODEL);
  const [models, setModels] = useState([]);
  const [activeMode, setActiveMode] = useState('demo');
  const [hostedStatus, setHostedStatus] = useState(null);
  const [probing, setProbing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [probeMessage, setProbeMessage] = useState('');
  const [probeError, setProbeError] = useState('');

  useEffect(() => {
    if (!open) return;
    const config = getOllamaConfig();
    setBaseUrl(config?.baseUrl || DEFAULT_OLLAMA_BASE_URL);
    setModel(config?.model || DEFAULT_OLLAMA_MODEL);
    setModels([]);
    setProbeMessage('');
    setProbeError('');
    setActiveMode(getAIMode());
    setHostedStatus(null);
    checkAIStatus().then(setHostedStatus);
  }, [open]);

  const handleProbe = async () => {
    setProbing(true);
    setProbeError('');
    setProbeMessage('');
    try {
      const result = await probeOllama(baseUrl);
      setModels(result.models);
      setProbeMessage(result.models.length
        ? `Connected. Models found: ${result.models.join(', ')}`
        : 'Connected, but no model is installed. Run ollama pull llama3.2, then try again.');
    } catch (error) {
      setProbeError(error.message || 'Could not connect to Ollama.');
    } finally {
      setProbing(false);
    }
  };

  const handleSave = async (event) => {
    event.preventDefault();
    setSaving(true);
    setProbeError('');
    setProbeMessage('');
    try {
      const result = await configureOllama({ baseUrl, model });
      setBaseUrl(result.baseUrl);
      setModel(result.model);
      setModels(result.models);
      setActiveMode('ollama');
      setProbeMessage(`Saved ${result.model}. Atlas will call this local model directly from your browser.`);
      toast.success('Local Ollama model connected', { description: `${result.model} is now Atlas's selected AI model.` });
      await onStatusChange?.();
    } catch (error) {
      setProbeError(error.message || 'Could not save this Ollama model.');
      if (Array.isArray(error.models)) setModels(error.models);
    } finally {
      setSaving(false);
    }
  };

  const activateMode = async (mode) => {
    try {
      setAIMode(mode);
      setActiveMode(mode);
      await onStatusChange?.();
      if (mode !== 'ollama') onOpenChange(false);
    } catch (error) {
      toast.error('Could not change AI mode', { description: error.message });
    }
  };

  const hostedAvailable = !!(hostedStatus?.configured && hostedStatus?.provider);
  const isHostedMode = activeMode === 'hosted';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5" /> AI setup
          </DialogTitle>
          <DialogDescription>
            Atlas itself adds no request, token, or daily quota. The default real-model path is Ollama on this computer; prompts go directly from this browser to 127.0.0.1:11434, never through Vercel.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <section className="rounded-lg border border-border p-4 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold">Local Ollama (recommended default)</h3>
                <p className="text-xs text-foreground/55 mt-1">
                  On-device models only. Atlas serializes local calls in click order when the model is busy; it does not reject clicks or impose an app-side usage budget.
                </p>
              </div>
              {activeMode === 'ollama' && (
                <span className="shrink-0 inline-flex items-center gap-1 text-xs text-green-700">
                  <CheckCircle2 className="h-3.5 w-3.5" /> Selected
                </span>
              )}
            </div>

            <form onSubmit={handleSave} className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="ollama-base-url">Local Ollama base URL</Label>
                <Input
                  id="ollama-base-url"
                  value={baseUrl}
                  onChange={(event) => setBaseUrl(event.target.value)}
                  placeholder={DEFAULT_OLLAMA_BASE_URL}
                  autoComplete="url"
                />
                <p className="text-[11px] text-foreground/45">
                  Local loopback addresses only. Default: http://127.0.0.1:11434. Atlas will not save a public host.
                </p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="ollama-model">Installed model name</Label>
                <Input
                  id="ollama-model"
                  value={model}
                  onChange={(event) => setModel(event.target.value)}
                  placeholder={DEFAULT_OLLAMA_MODEL}
                  list={modelListId}
                  autoComplete="off"
                />
                <datalist id={modelListId}>
                  {models.map((name) => <option key={name} value={name} />)}
                </datalist>
                <p className="text-[11px] text-foreground/45">
                  Save probes <code>/api/tags</code> and only stores a model that Ollama reports as installed.
                </p>
              </div>

              {probeMessage && (
                <p className="flex items-start gap-1.5 text-xs text-green-700" role="status">
                  <CheckCircle2 className="h-4 w-4 shrink-0" /> {probeMessage}
                </p>
              )}
              {probeError && (
                <div className="flex items-start gap-2 rounded-md bg-amber-50 border border-amber-200 p-3 text-xs text-amber-900" role="alert">
                  <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                  <span>{probeError}</span>
                </div>
              )}

              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" onClick={handleProbe} disabled={probing || saving}>
                  {probing ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  {probing ? 'Checking…' : 'Check connection'}
                </Button>
                <Button type="submit" disabled={saving || probing || !model.trim()}>
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  {saving ? 'Probing and saving…' : 'Probe & save local model'}
                </Button>
                {getOllamaConfig() && activeMode !== 'ollama' && (
                  <Button type="button" variant="ghost" onClick={() => activateMode('ollama')} disabled={saving || probing}>
                    Use saved Ollama model
                  </Button>
                )}
              </div>
            </form>
          </section>

          <details className="rounded-lg border border-border p-4">
            <summary className="cursor-pointer text-sm font-medium">Install Ollama and allow this Atlas origin</summary>
            <div className="mt-3 space-y-3 text-xs text-foreground/70">
              <p>Install Ollama, then download a local model. Example:</p>
              <pre className="overflow-x-auto rounded bg-muted p-3"><code>{`# macOS or Linux:
curl -fsSL https://ollama.com/install.sh | sh
# Windows PowerShell:
irm https://ollama.com/install.ps1 | iex

ollama pull llama3.2`}</code></pre>
              <p>macOS desktop-app alternative: <a className="underline" href="https://ollama.com/download/mac" target="_blank" rel="noreferrer">ollama.com/download/mac</a>.</p>
              <p>
                Set <code>OLLAMA_ORIGINS</code> to the exact origin shown in your browser (include both local dev and deployed Atlas origins if you use both). Replace <code>https://YOUR-ATLAS-ORIGIN</code>; do not use a wildcard. Keep the service bound to loopback.
              </p>
              <p className="font-medium">macOS / Linux foreground server (quit any existing Ollama service first):</p>
              <pre className="overflow-x-auto rounded bg-muted p-3"><code>{`OLLAMA_NO_CLOUD=1 OLLAMA_HOST=127.0.0.1:11434 OLLAMA_ORIGINS="http://localhost:5173,https://YOUR-ATLAS-ORIGIN" ollama serve`}</code></pre>
              <p className="font-medium">Windows PowerShell (after quitting Ollama from the system tray):</p>
              <pre className="overflow-x-auto rounded bg-muted p-3"><code>{`$env:OLLAMA_NO_CLOUD = "1"
$env:OLLAMA_HOST = "127.0.0.1:11434"
$env:OLLAMA_ORIGINS = "http://localhost:5173,https://YOUR-ATLAS-ORIGIN"
ollama serve`}</code></pre>
              <p>
                If you run Ollama as a desktop app or service, set those same variables in its environment and restart it. Never bind Ollama to <code>0.0.0.0</code>, forward port <code>11434</code>, or expose it to the public internet.
              </p>
              <p className="font-semibold text-foreground">
                A hosted free key is still capped by that provider. Atlas no longer adds a cap of its own; no hosted provider is described as unlimited.
              </p>
            </div>
          </details>

          <section className="rounded-lg border border-border p-4 space-y-2">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold">Optional hosted provider</h3>
                <p className="text-xs text-foreground/55 mt-1">
                  A deployment may configure NaraRouter, Gemini, Groq, OpenRouter, OpenAI, or Anthropic server-side. Hosted keys are optional, stay out of the Vite bundle, and remain subject to the provider's own quotas and errors.
                </p>
              </div>
            </div>
            {hostedAvailable ? (
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <p className="text-xs text-foreground/60">Available on this deployment: <span className="font-medium">{hostedStatus.provider === 'nararouter' ? 'NaraRouter' : hostedStatus.provider}</span></p>
                <Button
                  type="button"
                  variant={isHostedMode ? 'secondary' : 'outline'}
                  size="sm"
                  onClick={() => activateMode('hosted')}
                >
                  {isHostedMode ? 'Hosted selected' : 'Use hosted provider'}
                </Button>
              </div>
            ) : (
              <p className="text-xs text-foreground/45">
                No hosted provider is configured here. That is optional: connect Ollama above, or see DEPLOYMENT.md to configure a hosted key. Every hosted provider can impose its own caps.
              </p>
            )}
            {hostedAvailable && hostedStatus.provider === 'nararouter' && (
              <div className="space-y-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-950" role="note">
                <p>
                  NaraRouter is hosted, not local. Its live pricing page currently lists 7 million tokens per day and 15 requests per minute for Free; available model aliases and limits can change. Atlas adds no quota and does not bypass NaraRouter's actual errors.
                </p>
                <p>
                  Prompts are relayed to NaraRouter's selected upstream model provider. Its privacy policy says upstream retention terms apply and that the service is not directed to people under 18. Review those terms before sending student profiles, essays, or materials—especially data about minors.
                </p>
                <p className="flex flex-wrap gap-x-3 gap-y-1">
                  <a className="underline" href="https://router.bynara.id/docs" target="_blank" rel="noreferrer">NaraRouter API docs</a>
                  <a className="underline" href="https://router.bynara.id/pricing" target="_blank" rel="noreferrer">Free-plan limits</a>
                  <a className="underline" href="https://router.bynara.id/privacy" target="_blank" rel="noreferrer">Privacy policy</a>
                </p>
              </div>
            )}
          </section>

          <div className="flex items-center justify-between gap-3 border-t border-border pt-4">
            <p className="text-xs text-foreground/45">
              Current mode: <span className="font-medium text-foreground">{activeMode === 'ollama' ? 'Local Ollama' : activeMode === 'hosted' ? 'Hosted provider' : 'Labeled demo'}</span>
            </p>
            {activeMode !== 'demo' && (
              <Button type="button" variant="ghost" size="sm" onClick={() => activateMode('demo')}>
                Use demo mode
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
