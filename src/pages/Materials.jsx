import { useState, useEffect, useMemo, useRef } from 'react';
import { toast } from 'sonner';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  Plus, Trash2, FileText, Link as LinkIcon, Upload, File, Award, StickyNote,
  Loader2, Pencil, ChevronDown, CircleAlert, CheckCircle2, Info, TriangleAlert,
  Sparkles, BookOpen, RotateCw, X,
} from 'lucide-react';
import { hasLiveModel } from '@/lib/aiOutcome';
import { materialJobs } from '@/lib/materialService';
import { needsWork } from '@/lib/materialJobs';
import { FINDING_KINDS, localSignals } from '@/lib/materialAnalysis';
import { MAX_DOCUMENT_CHARS } from '@/lib/documentReader';
import {
  MATERIAL_TYPES, presentMaterial, materialWritePayload, isMaterialTypeCheckError, isSampleMaterial,
} from '@/lib/materialRole';
import {
  legacyMigrationPatch, legacyTypedText, mergeLegacyIntoNotes, materialSource, materialDisplayName,
} from '@/lib/materialDocument';

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
const typeIcon = (type) => materialTypes.find((t) => t.value === type)?.icon || File;

/** Files Atlas can read. Old .doc files and images are offered, and explained, when chosen. */
const FILE_ACCEPT = '.pdf,.docx,.txt,.md,.markdown,.csv,.tsv,.rtf,.html,.htm,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown,text/csv,text/html';

const EMPTY_FORM = { title: '', type: 'document', link_url: '', notes: '' };

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

const TONE_CLASS = {
  ok: 'text-green-700',
  work: 'text-foreground/60',
  wait: 'text-amber-700',
  bad: 'text-red-700',
  muted: 'text-foreground/40',
};

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const formatDate = (iso) => {
  if (!iso) return '';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString();
};
const countWords = (text) => (text || '').trim().split(/\s+/).filter(Boolean).length;

/** One readable sentence for what is happening to a material, and what the user can do. */
function describeMaterial(item, job, modelReady) {
  const failed = (stage, message) => ({
    tone: 'bad',
    text: stage === 'reading'
      ? 'Atlas could not read this material.'
      : stage === 'saving' ? 'Atlas could not save the result.' : 'The analysis did not finish.',
    detail: message,
    retry: true,
  });
  if (job) {
    if (job.state === 'queued') return { tone: 'work', text: 'Queued. Atlas works through one material at a time.' };
    if (job.state === 'reading') return { tone: 'work', text: job.kind === 'link' ? 'Reading the web page…' : 'Reading the file…' };
    if (job.state === 'analyzing') {
      return {
        tone: 'work',
        text: job.parts ? `Analyzing the full document — part ${job.part} of ${job.parts}.` : 'Analyzing the full document…',
        progress: job.parts ? (job.part / job.parts) * 100 : null,
      };
    }
    if (job.state === 'waiting') return { tone: 'wait', text: 'Read. The analysis starts when a local model is connected (AI status in the sidebar).' };
    if (job.state === 'failed') return failed(job.stage, job.message);
    if (job.state === 'done' && job.persisted === false) {
      return {
        tone: 'bad',
        text: 'Analyzed, but the result could not be saved.',
        detail: 'Run supabase/schema.sql once in the Supabase SQL editor, then press Re-read & analyze.',
      };
    }
  }
  if (item.document_state === 'none') {
    return { tone: 'muted', text: 'Context note only. Upload a file or add a link so Atlas can read it.' };
  }
  if (item.analysis?.status === 'failed') return failed(item.analysis.stage, item.analysis.message);
  if (item.document_state === 'ready') {
    if (item.analysis?.status === 'ready') {
      return { tone: 'ok', text: `Read and analyzed ${formatDate(item.analysis.analyzed_at)}.` };
    }
    return modelReady
      ? { tone: 'work', text: 'Read. The analysis is starting…', retry: true }
      : { tone: 'wait', text: 'Read. The analysis starts when a local model is connected.' };
  }
  if (item.document_state === 'outdated') {
    return { tone: 'work', text: 'The file or link changed. Reading the new version…', retry: true };
  }
  return { tone: 'work', text: 'Not read yet. Reading starts automatically.', retry: true };
}

function needsAttention(item, job) {
  if (job?.state === 'failed') return true;
  if (item.document_state === 'none') return false;
  if (item.document_state !== 'ready') return true;
  return !item.analysis || item.analysis.status !== 'ready';
}

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

/** The instant, zero-cost read on the document text. Shown without a model call. */
function SignalLine({ text }) {
  const signals = useMemo(() => localSignals(text || ''), [text]);
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-foreground/45 mt-1.5">
      <span>{signals.words.toLocaleString()} words</span>
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

/** Renders the document text with every finding's exact words highlighted. */
function highlight(text, findings) {
  const usable = (findings || []).filter((f) => f.offset !== null && f.quote && text.slice(f.offset, f.offset + f.quote.length) === f.quote);
  if (!usable.length) return text;

  const out = [];
  let cursor = 0;
  usable.forEach((f, i) => {
    if (f.offset < cursor) return; // overlapping: skip, the earlier finding stays highlighted
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

function coverageNote(analysis) {
  const coverage = analysis?.coverage;
  const parts = [];
  // The reader stops at MAX_DOCUMENT_CHARS; the stored text then ends with a marker.
  if (Number(analysis?.source?.chars) > MAX_DOCUMENT_CHARS) {
    parts.push(`Atlas read only the first ${MAX_DOCUMENT_CHARS.toLocaleString()} characters of this document. The rest is not included in the analysis.`);
  }
  if (coverage && !coverage.complete) {
    if (coverage.parts_skipped > 0) {
      parts.push(`This document is longer than one analysis covers. Atlas analyzed the first ${coverage.parts_attempted} parts (${Number(coverage.analyzed_chars || 0).toLocaleString()} of ${Number(coverage.total_chars || 0).toLocaleString()} characters).`);
    }
    if (coverage.parts_failed > 0) {
      parts.push(`${plural(coverage.parts_failed, 'part')} could not be analyzed. Press Re-read & analyze to try again.`);
    }
  }
  return parts.join(' ');
}

function AnalysisView({ analysis }) {
  const findings = analysis.findings || [];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-4">
        <ScoreBar label="Overall" value={analysis.overall_score} />
        <ScoreBar label="Specificity" value={analysis.specificity_score} hint="names, numbers, concrete verbs" />
        <ScoreBar label="Rhythm" value={analysis.rhythm_score} hint="sentence-length variety" />
        <ScoreBar label="Voice" value={analysis.voice_score} hint="could only be this person" />
      </div>

      {coverageNote(analysis) && (
        <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-50 border border-amber-200">
          <TriangleAlert className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
          <p className="text-xs text-amber-800">{coverageNote(analysis)}</p>
        </div>
      )}

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
        <p className="text-sm text-foreground/60 leading-relaxed whitespace-pre-line">{analysis.summary}</p>
      )}

      {analysis.facts?.length > 0 && (
        <div className="rounded-lg border border-border p-3.5">
          <h4 className="text-xs font-medium text-foreground/60 mb-1.5">
            Facts about the applicant in this document — used in drafts and reviews
          </h4>
          <ul className="space-y-1 list-disc pl-4">
            {analysis.facts.map((fact, i) => (
              <li key={i} className="text-xs text-foreground/65">{fact}</li>
            ))}
          </ul>
        </div>
      )}

      {analysis.craft_moves?.length > 0 && (
        <div className="rounded-lg border border-border p-3.5">
          <h4 className="text-xs font-medium text-foreground/60 mb-1.5">
            Craft moves to study — technique, never this writer&apos;s life
          </h4>
          <ul className="space-y-1 list-disc pl-4">
            {analysis.craft_moves.map((move, i) => (
              <li key={i} className="text-xs text-foreground/65">{move}</li>
            ))}
          </ul>
        </div>
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

      {findings.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-xs font-medium text-foreground/60">
            {plural(findings.length, 'word-level finding')} — highlighted in the document text below
          </h4>
          <ul className="space-y-1.5">
            {findings.map((f) => {
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
        </div>
      )}
    </div>
  );
}

/** The stored document text, read-only. Findings are highlighted by default. */
function DocumentText({ text, findings, reader, fromFile }) {
  const [marked, setMarked] = useState(true);
  return (
    <div>
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h4 className="text-xs font-medium text-foreground/60">
          Document text · {countWords(text).toLocaleString()} words · read from the {fromFile ? 'uploaded file' : 'web page'}{reader ? ` (${reader})` : ''}
        </h4>
        {findings?.length > 0 && (
          <button onClick={() => setMarked(!marked)} className="text-[11px] text-foreground/40 hover:text-foreground/70">
            {marked ? 'Hide highlights' : 'Show highlights'}
          </button>
        )}
      </div>
      <div className="mt-2 max-h-96 overflow-y-auto rounded-lg border border-border bg-background p-4 text-sm leading-7 text-foreground/70 font-body whitespace-pre-wrap">
        {marked && findings?.length ? highlight(text, findings) : text}
      </div>
    </div>
  );
}

function MaterialCard({ item, job, modelReady, expanded, busy, onToggle, onEdit, onRemove, onRetry, onReread }) {
  const Icon = typeIcon(item.type);
  const status = describeMaterial(item, job, modelReady);
  const sample = isSampleMaterial(item);
  const hasDocument = item.document_state === 'ready';
  const canExpand = hasDocument || item.analysis?.status === 'ready';
  const sourceUrl = materialSource(item);
  const fromFile = !!item.file_url;

  return (
    <div className="group bg-card border border-border rounded-xl p-4 hover:border-foreground/15 transition">
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-lg bg-foreground/5 flex items-center justify-center shrink-0">
          <Icon className="w-4 h-4 text-foreground/50" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-medium text-sm">{item.title}</h3>
            {item.analysis?.status === 'ready' && (
              <Badge variant="outline" className="h-5 px-1.5 text-[10px] gap-1 text-green-700 border-green-300 bg-green-50">
                <CheckCircle2 className="w-2.5 h-2.5" /> analyzed
              </Badge>
            )}
            {item.analysis?.sounds_like_ai && (
              <Badge variant="outline" className="h-5 px-1.5 text-[10px] gap-1 text-red-700 border-red-300 bg-red-50">
                reads as AI
              </Badge>
            )}
            {sample && (
              <Badge variant="outline" className="h-5 px-1.5 text-[10px] text-slate-700 border-slate-300 bg-slate-50">
                sample — not the applicant&apos;s writing
              </Badge>
            )}
          </div>

          <p className={`mt-1 text-xs flex items-start gap-1.5 ${TONE_CLASS[status.tone] || ''}`}>
            {status.tone === 'work' && <Loader2 className="w-3 h-3 mt-0.5 animate-spin shrink-0" />}
            <span>{status.text}</span>
          </p>
          {status.progress !== null && status.progress !== undefined && (
            <div className="h-1.5 mt-1.5 max-w-xs bg-muted rounded-full overflow-hidden" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(status.progress)}>
              <div className="h-full bg-accent rounded-full transition-all duration-500" style={{ width: `${Math.round(status.progress)}%` }} />
            </div>
          )}
          {status.detail && <p className="text-[11px] text-red-700/80 mt-0.5 break-words">{status.detail}</p>}

          {fromFile && (
            <a href={item.file_url} target="_blank" rel="noopener noreferrer" className="text-xs text-accent hover:underline mt-1.5 inline-flex items-center gap-1">
              <File className="w-3 h-3" />
              {materialDisplayName(item) || 'Uploaded file'}
            </a>
          )}
          {item.link_url && (
            <a href={item.link_url} target="_blank" rel="noopener noreferrer" className="text-xs text-accent hover:underline mt-1 inline-flex items-center gap-1 break-all">
              <LinkIcon className="w-3 h-3 shrink-0" />
              {item.link_url}
            </a>
          )}
          {!sourceUrl && (
            <p className="text-[11px] text-foreground/35 mt-1">No file or link attached yet.</p>
          )}

          {item.notes && (
            <div className="mt-1.5">
              <span className="text-[10px] uppercase tracking-wide text-foreground/35">Context / Notes — what this file is, not analyzed as the document</span>
              <p className="text-xs text-foreground/50 mt-0.5 italic whitespace-pre-line">{item.notes}</p>
            </div>
          )}

          {!expanded && hasDocument && <SignalLine text={item.content} />}
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {status.retry && !busy && (
            <Button size="sm" variant="outline" onClick={onRetry}>
              <RotateCw className="w-3.5 h-3.5 mr-1.5" />
              Retry
            </Button>
          )}
          {canExpand && (
            <button
              onClick={onToggle}
              className="p-1.5 rounded text-foreground/30 hover:text-foreground hover:bg-muted transition"
              title={expanded ? 'Hide document' : 'Show document and analysis'}
              aria-expanded={expanded}
            >
              <ChevronDown className={`w-3.5 h-3.5 transition-transform ${expanded ? 'rotate-180' : ''}`} />
            </button>
          )}
          <button onClick={onEdit} className="p-1.5 rounded text-foreground/30 hover:text-foreground hover:bg-muted transition" title="Edit">
            <Pencil className="w-3.5 h-3.5" />
          </button>
          <button onClick={onRemove} className="p-1.5 rounded text-foreground/30 hover:text-destructive hover:bg-destructive/5 transition" title="Remove">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {expanded && canExpand && (
        <div className="mt-3 border-t border-border pt-3 space-y-4">
          <div className="flex items-center gap-2 flex-wrap">
            {hasDocument && (
              <Button size="sm" variant="outline" onClick={onReread} disabled={busy}>
                {busy ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <RotateCw className="w-3.5 h-3.5 mr-1.5" />}
                Re-read &amp; analyze
              </Button>
            )}
            {item.analysis?.status === 'ready' && (
              <span className="text-[11px] text-foreground/35">
                Analyzed {formatDate(item.analysis.analyzed_at)}
                {item.analysis.source?.reader ? ` from ${item.analysis.source.reader}` : ''}
              </span>
            )}
          </div>
          {item.analysis?.status === 'ready' && <AnalysisView analysis={item.analysis} />}
          {hasDocument && (
            <DocumentText
              text={item.content}
              findings={item.analysis?.status === 'ready' ? item.analysis.findings : []}
              reader={item.document_reader}
              fromFile={fromFile}
            />
          )}
        </div>
      )}
    </div>
  );
}

export default function Materials() {
  // Raw database rows. Presentation (what is the document, what is context)
  // is derived from them, so a row is never presented twice.
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [jobStatus, setJobStatus] = useState({});
  const [migration, setMigration] = useState(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [file, setFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const [expandedId, setExpandedId] = useState(null);
  const [filter, setFilter] = useState('all');
  const fileInputRef = useRef(null);
  const modelReady = hasLiveModel();

  const shown = useMemo(() => rows.map(presentMaterial), [rows]);

  useEffect(() => materialJobs.subscribe((id, status) => {
    setJobStatus((prev) => {
      const next = { ...prev };
      if (status) next[id] = status;
      else delete next[id];
      return next;
    });
  }), []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await base44.entities.Material.list();
        // Move old pasted text out of the Content box, and drop analyses made from it.
        const migrated = [];
        const counts = { moved: 0, cleared: 0 };
        for (const row of list) {
          const patch = legacyMigrationPatch(row);
          if (!patch) {
            migrated.push(row);
            continue;
          }
          if (patch.content === null && legacyTypedText(row)) counts.moved += 1;
          if (patch.analysis === null && row.analysis) counts.cleared += 1;
          try {
            const saved = await base44.entities.Material.update(row.id, patch);
            migrated.push({ ...row, ...(saved || {}), ...patch });
          } catch (error) {
            // Keep the row as stored. Its old text still shows, in Context.
            console.error(error);
            migrated.push(row);
          }
        }
        if (cancelled) return;
        setRows(migrated);
        if (counts.moved || counts.cleared) setMigration(counts);
        const ready = hasLiveModel();
        for (const row of migrated) {
          if (needsWork(presentMaterial(row), { modelReady: ready })) queueRead(row, { notify: false });
        }
      } catch (e) {
        console.error(e);
        toast.error('Could not load your materials', { description: e.message });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // Runs once per visit; the queue handles everything after that.
  }, []);

  /** Puts what a job produced back into the list. Only job-owned fields are copied. */
  const applyJobResult = (result) => {
    if (!result || !result.id) return;
    setRows((prev) => prev.map((row) => {
      if (row.id !== result.id) return row;
      const next = {
        ...row,
        content: result.content !== undefined ? result.content : row.content,
        analysis: result.analysis !== undefined ? result.analysis : row.analysis,
      };
      if (result.legacyMoved) next.notes = mergeLegacyIntoNotes(row.notes, legacyTypedText(row));
      return next;
    }));
  };

  const queueRead = (row, options = {}) => materialJobs.enqueue(row, options)
    .then(applyJobResult)
    .catch((error) => console.error(error));

  const openAdd = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setFile(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
    setDialogOpen(true);
  };

  const openEdit = (row) => {
    setEditing(row);
    setForm({
      title: row.title || '',
      type: isSampleMaterial(row) ? 'sample_essay' : (row.type || 'document'),
      link_url: row.link_url || '',
      notes: presentMaterial(row).notes || '',
    });
    setFile(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
    setDialogOpen(true);
  };

  const handleFileChange = (e) => {
    const chosen = e.target.files?.[0] || null;
    if (chosen && /\.doc$/i.test(chosen.name)) {
      toast.message('Old Word files cannot be read here', {
        description: 'Save the file as .docx or PDF in Word or Google Docs, then choose that copy.',
      });
      e.target.value = '';
      setFile(null);
      return;
    }
    setFile(chosen);
  };

  const handleSave = async () => {
    const title = form.title.trim();
    if (!title) return;
    setSaving(true);
    try {
      const previousSource = editing ? materialSource(editing) : '';
      let fileUrl = editing?.file_url || '';
      if (file) {
        const uploaded = await base44.integrations.Core.UploadPublicFile({ file });
        fileUrl = uploaded.file_url;
      }
      const linkUrl = form.link_url.trim();
      const payload = {
        title,
        type: form.type,
        link_url: linkUrl,
        file_url: fileUrl,
        notes: form.notes,
        // Content and analysis are written only by the reader, never from this form.
      };
      const write = async (body) => (editing
        ? base44.entities.Material.update(editing.id, body)
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
      if (!saved) throw new Error('The material could not be saved. It may have been removed in another window.');

      const nextSource = materialSource({ file_url: fileUrl, link_url: linkUrl });
      const documentChanged = !!file || nextSource !== previousSource;
      setRows((prev) => (editing
        ? prev.map((row) => (row.id === saved.id ? { ...row, ...saved } : row))
        : [...prev, saved]));
      setDialogOpen(false);

      if (nextSource && documentChanged) {
        // A new or replaced document is read, then analysed, with no further step.
        queueRead(saved, { file: file || null, force: true, notify: true });
        toast.success(editing ? 'Material updated' : 'Material added', {
          description: 'Atlas is reading the document now. The analysis starts automatically.',
        });
      } else {
        toast.success(editing ? 'Material updated' : 'Material added');
      }
    } catch (e) {
      console.error(e);
      toast.error('Could not save this material', {
        description: e.message || 'If you uploaded a file, check the Supabase storage bucket named "uploads" exists. Nothing you entered was lost; the dialog is still open.',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async (row) => {
    if (!window.confirm(`Remove “${row.title}” from your materials?`)) return;
    try {
      await base44.entities.Material.delete(row.id);
      setRows((prev) => prev.filter((r) => r.id !== row.id));
      toast.success('Material removed');
    } catch (e) {
      toast.error('Could not remove this material', { description: e.message });
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32">
        <div className="w-8 h-8 border-2 border-border border-t-foreground rounded-full animate-spin" />
      </div>
    );
  }

  const visible = shown.filter((m) => {
    if (filter === 'all') return true;
    if (filter === 'analyzed') return m.analysis?.status === 'ready';
    if (filter === 'attention') return needsAttention(m, jobStatus[m.id]);
    return m.type === filter;
  });

  const grouped = materialTypes
    .map((t) => ({ ...t, items: visible.filter((m) => m.type === t.value) }))
    .filter((g) => g.items.length > 0);

  const analyzedCount = shown.filter((m) => m.analysis?.status === 'ready').length;
  const attentionCount = shown.filter((m) => needsAttention(m, jobStatus[m.id])).length;
  const editingHasFile = !!editing?.file_url;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="max-w-2xl">
          <h1 className="font-display text-3xl font-semibold tracking-tight">Materials</h1>
          <p className="text-foreground/50 mt-1.5 leading-relaxed">
            Your own documents and links are evidence about you. Atlas reads each one itself — a PDF, a Word file, a text file, or a web page — and
            analyzes the whole text, marking word-level findings, starting as soon as it is added. A successful essay from someone else is kept separately:
            Atlas studies its craft but never treats that life as yours.
          </p>
          <p className="text-xs text-foreground/40 mt-2 leading-relaxed">
            Context / Notes is for telling Atlas what a file is, for example “My robotics reflection, junior year” or “UK sample — Oxford PPE 2024”.
            It is kept with the material and is never analyzed as the document.
          </p>
          {shown.length > 0 && (
            <p className="text-xs text-foreground/40 mt-2 flex items-center gap-2 flex-wrap">
              <span>{plural(shown.length, 'material')} · {analyzedCount} analyzed</span>
              {attentionCount > 0 && (
                <button onClick={() => setFilter('attention')} className="text-amber-600 hover:underline">
                  · {attentionCount} need{attentionCount === 1 ? 's' : ''} attention
                </button>
              )}
              <span className="text-foreground/30">· Used in every essay draft and holistic review.</span>
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Select value={filter} onValueChange={setFilter}>
            <SelectTrigger className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All materials</SelectItem>
              <SelectItem value="analyzed">Analyzed</SelectItem>
              <SelectItem value="attention">Needs attention</SelectItem>
              {materialTypes.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button onClick={openAdd}>
            <Plus className="w-4 h-4 mr-2" />
            Add Material
          </Button>
        </div>
      </div>

      {migration && (
        <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
          <Info className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
          <div className="flex-1 text-sm text-amber-900 space-y-1">
            <p className="font-medium">Your materials were updated.</p>
            {migration.moved > 0 && (
              <p className="text-xs leading-relaxed">
                Text that had been pasted into the old Content box ({plural(migration.moved, 'material')}) was moved into its Context / Notes, under a heading that says so. Nothing was deleted.
              </p>
            )}
            {migration.cleared > 0 && (
              <p className="text-xs leading-relaxed">
                {plural(migration.cleared, 'analysis')} made from pasted text {migration.cleared === 1 ? 'was' : 'were'} removed. Atlas reads each file again, from the file itself, and analyzes it.
              </p>
            )}
          </div>
          <button onClick={() => setMigration(null)} className="text-amber-700 hover:text-amber-900" aria-label="Dismiss">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {!modelReady && shown.length > 0 && (
        <p className="text-xs text-foreground/50 rounded-lg border border-border bg-card px-3.5 py-2.5">
          No local model is connected. Atlas still reads each document now; the analysis starts once you connect a model in AI setup (the AI status in the sidebar).
        </p>
      )}

      {shown.length === 0 ? (
        <div className="bg-card border border-border rounded-xl p-16 text-center">
          <FileText className="w-10 h-10 text-foreground/20 mx-auto mb-4" />
          <h3 className="font-display text-lg font-medium mb-1">No materials yet</h3>
          <p className="text-sm text-foreground/40 mb-5 max-w-md mx-auto">
            Upload a past essay or a resume of your own, or add a web page. Atlas reads the file itself.
            A successful essay from someone else can be added as a sample; it is never treated as your life.
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
                {group.items.map((item) => {
                  const job = jobStatus[item.id];
                  const busy = !!job && (job.state === 'queued' || job.state === 'reading' || job.state === 'analyzing');
                  return (
                    <MaterialCard
                      key={item.id}
                      item={item}
                      job={job}
                      busy={busy}
                      modelReady={modelReady}
                      expanded={expandedId === item.id}
                      onToggle={() => setExpandedId(expandedId === item.id ? null : item.id)}
                      onEdit={() => openEdit(rows.find((r) => r.id === item.id) || item)}
                      onRemove={() => handleRemove(rows.find((r) => r.id === item.id) || item)}
                      onRetry={() => queueRead(rows.find((r) => r.id === item.id) || item, { notify: true })}
                      onReread={() => queueRead(rows.find((r) => r.id === item.id) || item, { force: true, notify: true })}
                    />
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="font-display">{editing ? 'Edit Material' : 'Add Material'}</DialogTitle>
            <DialogDescription>
              Atlas reads the file or page itself, so nothing needs to be pasted. Reading and analysis start when you save.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label className="block text-xs font-medium text-foreground/50 mb-1.5">Title</Label>
              <Input
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                placeholder="e.g. Personal statement, draft 3"
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
              <Label className="block text-xs font-medium text-foreground/50 mb-1.5">Upload a file</Label>
              <input
                ref={fileInputRef}
                type="file"
                accept={FILE_ACCEPT}
                onChange={handleFileChange}
                className="w-full text-sm text-foreground/50 file:mr-3 file:py-2 file:px-3.5 file:rounded-lg file:border-0 file:bg-muted file:text-foreground file:font-medium file:cursor-pointer hover:file:bg-foreground/10 transition"
              />
              <p className="text-[11px] text-foreground/35 mt-1.5 leading-relaxed">
                PDF with selectable text, Word (.docx), plain text, Markdown, CSV, RTF, or a saved web page. Up to 30 MB.
                Old .doc files and photos cannot be read; save them as .docx or PDF first.
              </p>
              {file && <p className="text-xs text-foreground/50 mt-1.5">New file: {file.name}</p>}
              {editingHasFile && !file && (
                <p className="text-xs text-foreground/40 mt-1.5">Current file: {materialDisplayName(editing)}. Choose another file to replace it.</p>
              )}
            </div>
            <div>
              <Label className="block text-xs font-medium text-foreground/50 mb-1.5">Or a web page</Label>
              <Input
                value={form.link_url}
                onChange={(e) => setForm({ ...form, link_url: e.target.value })}
                placeholder="https://…"
              />
              <p className="text-[11px] text-foreground/35 mt-1">
                Public pages only. If a site blocks reading from the browser, save the page as a PDF and upload that instead.
              </p>
            </div>
            <div>
              <Label className="block text-xs font-medium text-foreground/50 mb-1.5">Context / Notes — what this file is (not analyzed as the document)</Label>
              <Textarea
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                placeholder="e.g. 'My personal reflection on robotics club, junior year — focus on leadership' or 'UK sample — Oxford PPE successful essay 2024, study its opening'"
                rows={3}
              />
              <p className="text-[11px] text-foreground/35 mt-1">Tell the AI what this file is. It is never scored for authenticity.</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving || !form.title.trim()}>
              {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Upload className="w-4 h-4 mr-2" />}
              {saving ? 'Saving…' : editing ? 'Save' : 'Add Material'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
