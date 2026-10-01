import { useState, useEffect, useRef, useMemo } from 'react';
import { toast } from 'sonner';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import {
  Plus, Trash2, FileText, Link as LinkIcon, Upload, File, Award, StickyNote,
  Loader2, Pencil, ScanText, ChevronDown, CircleAlert, CheckCircle2, Info,
  TriangleAlert, Sparkles, BookOpen,
} from 'lucide-react';
import { runAI } from '@/lib/ai';
import {
  buildEssayAnalysisPrompt, ESSAY_ANALYSIS_SCHEMA, normalizeAnalysis,
  localSignals, FINDING_KINDS,
} from '@/lib/materialAnalysis';
import {
  MATERIAL_TYPES, presentMaterial, materialWritePayload, isMaterialTypeCheckError, isSampleMaterial,
} from '@/lib/materialRole';

const TYPE_ICONS = {
  document: File,
  link: LinkIcon,
  essay: FileText,
  sample_essay: BookOpen,
  resume: FileText,
  transcript: File,
  award: Award,
  note: StickyNote,
  other: File,
};

const materialTypes = MATERIAL_TYPES.map((t) => ({ ...t, icon: TYPE_ICONS[t.value] || File }));

// Materials that are actual prose are worth a word-level read; a bare URL or a
// certificate stub is not, so the Analyze button only appears where it helps.
const ANALYZABLE = new Set(['essay', 'sample_essay', 'resume', 'transcript', 'note', 'document']);

const typeIcon = (type) => materialTypes.find((t) => t.value === type)?.icon || File;

const FINDING_ICON = {
  strength: CheckCircle2,
  issue: CircleAlert,
  risk: TriangleAlert,
  style: Info,
};

const FINDING_CLASS = {
  strength: 'text-green-600 bg-green-50 border-green-200',
  issue: 'text-red-600 bg-red-50 border-red-200',
  risk: 'text-amber-700 bg-amber-50 border-amber-200',
  style: 'text-slate-700 bg-slate-50 border-slate-200',
};

/** @param {{ label: string, value?: number | null, hint?: string }} props */
function ScoreBar({ label, value, hint }) {
  if (value === null || value === undefined) return null;
  const pct = Math.max(0, Math.min(100, value * 10));
  const bar = value >= 7 ? 'bg-green-500' : value >= 5 ? 'bg-amber-500' : 'bg-red-500';
  return (
    <div className="min-w-[120px] flex-1">
      <div className="flex items-baseline justify-between gap-2 mb-1">
        <span className="text-[11px] text-foreground/45">{label}</span>
        <span className="text-xs font-medium">{value}/10</span>
      </div>
      <div className="h-1.5 bg-muted rounded-full overflow-hidden">
        <div className={`h-full ${bar} rounded-full transition-all duration-700`} style={{ width: `${pct}%` }} />
      </div>
      {hint && <p className="text-[10px] text-foreground/35 mt-0.5">{hint}</p>}
    </div>
  );
}

/**
 * The instant, zero-cost read on a piece of text. Shown on every collapsed
 * card, because "this contains 3 stock AI phrases" is something you should be
 * able to see without spending a model call on it.
 */
function SignalLine({ signals }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-foreground/45 mt-1.5">
      <span>{signals.words} words</span>
      <span>{signals.sentences} sentences</span>
      {signals.longSentences > 0 && (
        <span className="text-amber-600">{signals.longSentences} sentence{signals.longSentences > 1 ? 's' : ''} over 30 words</span>
      )}
      {signals.aiPhrases.length > 0 && (
        <span className="text-red-600">{signals.aiPhrases.length} stock AI phrase{signals.aiPhrases.length > 1 ? 's' : ''}</span>
      )}
      {signals.weakVerbs.length > 0 && <span>{signals.weakVerbs.length} inflated word{signals.weakVerbs.length > 1 ? 's' : ''}</span>}
      {signals.hedges > 3 && <span>{signals.hedges} hedges</span>}
    </div>
  );
}

function AnalysisView({ material, onAnalyze, analyzing, analysis }) {
  const [showRaw, setShowRaw] = useState(false);
  const text = material?.content || '';

  return (
    <div className="mt-3 border-t border-border pt-3 space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <Button size="sm" variant={analysis ? 'ghost' : 'default'} onClick={onAnalyze} disabled={analyzing || !text.trim()}>
          {analyzing ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <ScanText className="w-3.5 h-3.5 mr-1.5" />}
          {analyzing ? 'Reading word by word…' : analysis ? 'Re-analyze' : 'Analyze word-by-word'}
        </Button>
        {analysis && (
          <span className="text-[11px] text-foreground/35">
            Analyzed {new Date(analysis.analyzed_at).toLocaleString()}
          </span>
        )}
      </div>

      {analysis && (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-4">
            <ScoreBar label="Overall" value={analysis.overall_score} />
            <ScoreBar label="Specificity" value={analysis.specificity_score} hint="names, numbers, concrete verbs" />
            <ScoreBar label="Rhythm" value={analysis.rhythm_score} hint="sentence-length variety" />
            <ScoreBar label="Voice" value={analysis.voice_score} hint="could only be this person" />
          </div>

          {analysis.sounds_like_ai && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 border border-red-200">
              <TriangleAlert className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
              <p className="text-xs text-red-700">
                The AI read this as machine-generated. Admissions readers are trained to spot exactly this —
                fix the stock phrases below before sending anything.
              </p>
            </div>
          )}

          {analysis.thesis && (
            <p className="text-xs text-foreground/55">
              <span className="font-medium text-foreground/70">What it is actually saying: </span>
              {analysis.thesis}
            </p>
          )}
          {analysis.summary && (
            <p className="text-sm text-foreground/60 leading-relaxed">{analysis.summary}</p>
          )}

          {analysis.top_actions?.length > 0 && (
            <div className="bg-accent/5 border border-accent/20 rounded-lg p-3.5">
              <h4 className="text-xs font-medium text-accent mb-1.5 flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5" /> Do these first
              </h4>
              <ol className="space-y-1">
                {analysis.top_actions.map((a, i) => (
                  <li key={i} className="text-xs text-foreground/65 flex gap-2">
                    <span className="font-medium text-accent">{i + 1}.</span>{a}
                  </li>
                ))}
              </ol>
            </div>
          )}

          {analysis.findings?.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-medium text-foreground/60">
                  {analysis.findings.length} word-level finding{analysis.findings.length > 1 ? 's' : ''}
                </h4>
                <button onClick={() => setShowRaw(!showRaw)} className="text-[11px] text-foreground/40 hover:text-foreground/70">
                  {showRaw ? 'Show highlighted' : 'Show as a list'}
                </button>
              </div>

              {showRaw ? (
                <ul className="space-y-1.5">
                  {analysis.findings.map((f) => {
                    const Icon = FINDING_ICON[f.kind] || Info;
                    return (
                      <li key={f.id} className={`rounded-lg border p-2.5 ${FINDING_CLASS[f.kind] || FINDING_CLASS.style}`}>
                        <div className="flex items-center gap-1.5 mb-1">
                          <Icon className="w-3.5 h-3.5" />
                          <span className="text-[10px] font-semibold uppercase tracking-wide">
                            {FINDING_KINDS[f.kind]?.label || 'Note'}
                          </span>
                        </div>
                        {f.quote && <p className="text-xs italic font-mono">“{f.quote}”</p>}
                        {f.note && <p className="text-xs mt-1">{f.note}</p>}
                        {f.suggestion && <p className="text-xs mt-1 opacity-80">→ {f.suggestion}</p>}
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <div className="relative text-sm leading-7 text-foreground/70 font-body max-h-80 overflow-y-auto rounded-lg border border-border bg-background p-4">
                  {highlight(text, analysis.findings)}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Renders the source text with every finding's exact words highlighted. */
function highlight(text, findings) {
  const usable = (findings || []).filter((f) => f.offset !== null && f.quote);
  if (!usable.length) return text;

  const out = [];
  let cursor = 0;
  usable.forEach((f, i) => {
    if (f.offset < cursor) return; // overlapping or out-of-order — skip
    if (f.offset > cursor) out.push(text.slice(cursor, f.offset));
    const cls = {
      strength: 'bg-green-100 text-green-900 underline decoration-green-500',
      issue: 'bg-red-100 text-red-900 underline decoration-red-500',
      risk: 'bg-amber-100 text-amber-900 underline decoration-amber-500',
      style: 'bg-slate-100 text-slate-900 underline decoration-slate-400',
    }[f.kind] || 'bg-muted';
    out.push(
      <mark key={`${f.id}-${i}`} className={`${cls} rounded px-0.5 decoration-1 underline-offset-2`} title={`${FINDING_KINDS[f.kind]?.label || 'Note'}: ${f.note || ''}`}>
        {text.slice(f.offset, f.offset + f.quote.length)}
      </mark>,
    );
    cursor = f.offset + f.quote.length;
  });
  if (cursor < text.length) out.push(text.slice(cursor));
  return out;
}

export default function Materials() {
  const [materials, setMaterials] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingMaterial, setEditingMaterial] = useState(null);
  const [form, setForm] = useState({ title: '', type: 'document', content: '', link_url: '', notes: '' });
  const [file, setFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const [analyzingId, setAnalyzingId] = useState(null);
  const [expandedId, setExpandedId] = useState(null);
  const [filter, setFilter] = useState('all');
  const fileInputRef = useRef(null);

  useEffect(() => {
    loadData();
  }, []);

  // Instant, local (no-AI) signals for every material. Kept in a memo above all
  // early returns so the hook order never changes.
  const signalById = useMemo(
    () => Object.fromEntries(materials.map((m) => [m.id, localSignals(m.content || '')])),
    [materials],
  );

  const loadData = async () => {
    try {
      const mats = await base44.entities.Material.list();
      setMaterials(mats.map(presentMaterial));
    } catch (e) {
      console.error(e);
      toast.error('Could not load your materials', { description: e.message });
    } finally {
      setLoading(false);
    }
  };

  const openAdd = () => {
    setEditingMaterial(null);
    setForm({ title: '', type: 'document', content: '', link_url: '', notes: '' });
    setFile(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
    setDialogOpen(true);
  };

  const openEdit = (mat) => {
    const shown = presentMaterial(mat);
    setEditingMaterial(shown);
    setForm({ title: shown.title, type: shown.type, content: shown.content || '', link_url: shown.link_url || '', notes: shown.notes || '' });
    setFile(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
    setDialogOpen(true);
  };

  const handleFileChange = (e) => setFile(e.target.files[0]);

  const handleSave = async () => {
    if (!form.title) return;
    setSaving(true);
    try {
      let file_url = editingMaterial?.file_url || '';
      if (file) {
        const result = await base44.integrations.Core.UploadPublicFile({ file });
        file_url = result.file_url;
      }
      const payload = {
        title: form.title,
        type: form.type,
        content: form.content,
        link_url: form.link_url,
        file_url,
        notes: form.notes,
        // Re-saving from the dialog must never silently drop a stored analysis.
        ...(editingMaterial?.analysis ? { analysis: editingMaterial.analysis } : {}),
      };
      const write = async (body) => (editingMaterial
        ? base44.entities.Material.update(editingMaterial.id, body)
        : base44.entities.Material.create(body));
      let saved;
      try {
        saved = await write(materialWritePayload(payload));
      } catch (error) {
        if (!isMaterialTypeCheckError(error)) throw error;
        saved = await write(materialWritePayload(payload, { forceLegacy: true }));
        toast.message('Saved as a sample essay', {
          description: 'This database still rejects the new type. Re-run supabase/schema.sql in the Supabase SQL editor so it is stored as its own type. Until then Atlas keeps a marker in the notes.',
        });
      }
      const shown = presentMaterial(saved);
      if (editingMaterial) {
        setMaterials((prev) => prev.map((m) => (m.id === shown.id ? shown : m)));
        toast.success('Material updated');
      } else {
        setMaterials((prev) => [...prev, shown]);
        toast.success('Material added');
      }
      setDialogOpen(false);
    } catch (e) {
      console.error(e);
      toast.error('Could not save this material', {
        description: e.message || 'If you uploaded a file, check the Supabase storage bucket named "uploads" exists.',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async (mat) => {
    if (!window.confirm(`Remove "${mat.title}"?`)) return;
    try {
      await base44.entities.Material.delete(mat.id);
      setMaterials((prev) => prev.filter((m) => m.id !== mat.id));
      toast.success('Material removed');
    } catch (e) {
      toast.error('Could not remove this material', { description: e.message });
    }
  };

  const handleAnalyze = async (mat) => {
    const text = mat.content || '';
    if (!text.trim()) {
      toast.error('Nothing to analyze', {
        description: 'Paste the text into the Content field first — Atlas reads the words you give it.',
      });
      return;
    }
    setAnalyzingId(mat.id);
    try {
      const { ok, result } = await runAI(
        {
          prompt: buildEssayAnalysisPrompt({ title: mat.title, text, kind: mat.type }),
          response_json_schema: ESSAY_ANALYSIS_SCHEMA,
        },
        { fallbackTitle: `Analysis failed for "${mat.title}"` },
      );
      if (!ok) return;

      const analysis = normalizeAnalysis(result, text);
      if (!analysis) {
        toast.error('The AI returned an unreadable analysis. Please try again.');
        return;
      }

      try {
        const updated = await base44.entities.Material.update(mat.id, { analysis });
        setMaterials((prev) => prev.map((m) => (m.id === mat.id ? presentMaterial({ ...m, ...updated, analysis }) : m)));
      } catch {
        // The `analysis` column is an optional upgrade — keep the result usable
        // in this session even when the database has not been updated yet.
        setMaterials((prev) => prev.map((m) => (m.id === mat.id ? { ...m, analysis } : m)));
        toast.warning('Analysis complete, but not saved', {
          description: 'Run supabase/schema.sql once in Supabase to keep analyses between sessions.',
        });
      }
      setExpandedId(mat.id);
    } finally {
      setAnalyzingId(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32">
        <div className="w-8 h-8 border-2 border-border border-t-foreground rounded-full animate-spin" />
      </div>
    );
  }

  const visible = materials.filter((m) => {
    if (filter === 'all') return true;
    if (filter === 'analyzed') return !!m.analysis;
    if (filter === 'unanalyzed') return ANALYZABLE.has(m.type) && !!m.content && !m.analysis;
    return m.type === filter;
  });

  const grouped = materialTypes
    .map((t) => ({ ...t, items: visible.filter((m) => m.type === t.value) }))
    .filter((g) => g.items.length > 0);

  const analyzedCount = materials.filter((m) => m.analysis).length;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-display text-3xl font-semibold tracking-tight">Materials</h1>
          <p className="text-foreground/50 mt-1.5">
            Your own documents, links, and past essays are evidence about you. A successful essay is someone
            else’s writing — Atlas studies the craft and must not treat that life as yours.
          </p>
          {materials.length > 0 && (
            <p className="text-xs text-foreground/40 mt-1">
              {analyzedCount} of {materials.length} analyzed
              {analyzedCount < materials.length && ' — analyze the rest for a complete picture.'}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Select value={filter} onValueChange={setFilter}>
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All materials</SelectItem>
              <SelectItem value="analyzed">Analyzed</SelectItem>
              <SelectItem value="unanalyzed">Not yet analyzed</SelectItem>
              {materialTypes.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button onClick={openAdd}>
            <Plus className="w-4 h-4 mr-2" />
            Add Material
          </Button>
        </div>
      </div>

      {materials.length === 0 ? (
        <div className="bg-card border border-border rounded-xl p-16 text-center">
          <FileText className="w-10 h-10 text-foreground/20 mx-auto mb-4" />
          <h3 className="font-display text-lg font-medium mb-1">No materials yet</h3>
          <p className="text-sm text-foreground/40 mb-5 max-w-md mx-auto">
            Paste a past essay or a resume of your own, or a successful essay you want studied as a sample.
            Atlas reads the words you give it. A sample is never treated as your life.
          </p>
          <Button onClick={openAdd}>
            <Plus className="w-4 h-4 mr-2" />
            Add Material
          </Button>
        </div>
      ) : visible.length === 0 ? (
        <div className="bg-card border border-border rounded-xl p-12 text-center">
          <p className="text-sm text-foreground/40">Nothing matches this filter.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {grouped.map((group) => (
            <div key={group.value}>
              <h2 className="text-sm font-medium text-foreground/50 mb-2.5 flex items-center gap-2">
                <group.icon className="w-4 h-4" />
                {group.label} ({group.items.length})
              </h2>
              <div className="space-y-2">
                {group.items.map((mat) => {
                  const Icon = typeIcon(mat.type);
                  const expandable = ANALYZABLE.has(mat.type) && !!(mat.content || '').trim();
                  const expanded = expandedId === mat.id;
                  const signals = signalById[mat.id] || localSignals('');
                  return (
                    <div key={mat.id} className="group bg-card border border-border rounded-xl p-4 hover:border-foreground/15 transition">
                      <div className="flex items-start gap-3">
                        <div className="w-9 h-9 rounded-lg bg-foreground/5 flex items-center justify-center shrink-0">
                          <Icon className="w-4 h-4 text-foreground/50" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <h3 className="font-medium text-sm">{mat.title}</h3>
                            {mat.analysis && (
                              <Badge variant="outline" className="h-5 px-1.5 text-[10px] gap-1 text-green-700 border-green-300 bg-green-50">
                                <CheckCircle2 className="w-2.5 h-2.5" /> analyzed
                              </Badge>
                            )}
                            {mat.analysis?.sounds_like_ai && (
                              <Badge variant="outline" className="h-5 px-1.5 text-[10px] gap-1 text-red-700 border-red-300 bg-red-50">
                                reads as AI
                              </Badge>
                            )}
                          </div>
                          {mat.content && <p className={`text-xs text-foreground/40 mt-0.5 ${expanded ? '' : 'line-clamp-2'}`}>{mat.content}</p>}
                          {mat.link_url && (
                            <a href={mat.link_url} target="_blank" rel="noopener noreferrer" className="text-xs text-accent hover:underline mt-0.5 inline-flex items-center gap-1">
                              <LinkIcon className="w-3 h-3" />
                              {mat.link_url}
                            </a>
                          )}
                          {mat.file_url && (
                            <a href={mat.file_url} target="_blank" rel="noopener noreferrer" className="text-xs text-accent hover:underline mt-0.5 inline-flex items-center gap-1">
                              <File className="w-3 h-3" />
                              View file
                            </a>
                          )}
                          {mat.notes && <p className="text-xs text-foreground/30 mt-1">{mat.notes}</p>}
                          {!expanded && expandable && <SignalLine signals={signals} />}
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          {expandable && !mat.analysis && !expanded && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleAnalyze(mat)}
                              disabled={analyzingId === mat.id}
                              className="opacity-0 group-hover:opacity-100 transition"
                            >
                              {analyzingId === mat.id
                                ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                                : <ScanText className="w-3.5 h-3.5 mr-1.5" />}
                              Analyze
                            </Button>
                          )}
                          {expandable && (
                            <button
                              onClick={() => setExpandedId(expanded ? null : mat.id)}
                              className="p-1.5 rounded text-foreground/30 hover:text-foreground hover:bg-muted transition"
                              title={expanded ? 'Hide analysis' : 'Show analysis'}
                            >
                              <ChevronDown className={`w-3.5 h-3.5 transition-transform ${expanded ? 'rotate-180' : ''}`} />
                            </button>
                          )}
                          <button onClick={() => openEdit(mat)} className="p-1.5 rounded text-foreground/30 hover:text-foreground hover:bg-muted transition">
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button onClick={() => handleRemove(mat)} className="p-1.5 rounded text-foreground/30 hover:text-destructive hover:bg-destructive/5 transition">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      {(expanded || analyzingId === mat.id) && expandable && (
                        <AnalysisView
                          analyzing={analyzingId === mat.id}
                          material={mat}
                          analysis={mat.analysis || null}
                          onAnalyze={() => handleAnalyze(mat)}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="font-display">{editingMaterial ? 'Edit Material' : 'Add Material'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label className="block text-xs font-medium text-foreground/50 mb-1.5">Title</Label>
              <Input
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                placeholder="Material title..."
              />
            </div>
            <div>
              <Label className="block text-xs font-medium text-foreground/50 mb-1.5">Type</Label>
              <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v })}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {materialTypes.map((t) => (
                    <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {isSampleMaterial({ type: form.type }) && (
                <p className="text-xs text-foreground/50 mt-1.5 leading-relaxed">
                  This is not your writing. Reviews will study its content, expression, voice, tone, and word
                  choice, and will not score it as your essay or borrow its biography.
                </p>
              )}
            </div>
            <div>
              <Label className="block text-xs font-medium text-foreground/50 mb-1.5">Upload File (optional)</Label>
              <input
                ref={fileInputRef}
                type="file"
                onChange={handleFileChange}
                className="w-full text-sm text-foreground/50 file:mr-3 file:py-2 file:px-3.5 file:rounded-lg file:border-0 file:bg-muted file:text-foreground file:font-medium file:cursor-pointer hover:file:bg-foreground/10 transition"
              />
              {file && <p className="text-xs text-foreground/40 mt-1.5">New file: {file.name}</p>}
              {editingMaterial?.file_url && !file && <p className="text-xs text-foreground/30 mt-1.5">Current file kept. Upload to replace.</p>}
            </div>
            <div>
              <Label className="block text-xs font-medium text-foreground/50 mb-1.5">Link URL</Label>
              <Input
                value={form.link_url}
                onChange={(e) => setForm({ ...form, link_url: e.target.value })}
                placeholder="https://..."
              />
            </div>
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <Label className="block text-xs font-medium text-foreground/50">Content / Text</Label>
                <span className="text-[11px] text-foreground/30">{(form.content || '').trim().split(/\s+/).filter(Boolean).length} words</span>
              </div>
              <Textarea
                value={form.content}
                onChange={(e) => setForm({ ...form, content: e.target.value })}
                placeholder="Paste the full text here. This is what the AI reads word by word — a link alone cannot be analyzed."
                rows={8}
              />
            </div>
            <div>
              <Label className="block text-xs font-medium text-foreground/50 mb-1.5">Notes</Label>
              <Input
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                placeholder="Any notes about this material..."
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving || !form.title}>
              {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Upload className="w-4 h-4 mr-2" />}
              {saving ? 'Saving...' : editingMaterial ? 'Update' : 'Add Material'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}