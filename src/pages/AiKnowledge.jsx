import { useState, useEffect, useCallback, useMemo } from 'react';
import { toast } from 'sonner';
import { base44 } from '@/api/base44Client';
import ContextTargetFields from '@/components/ContextTargetFields';
import { contextTargetFields, contextTargetLabel } from '@/lib/contextTargeting';
import { notifyAIError } from '@/lib/ai';
import { hasLiveModel } from '@/lib/aiOutcome';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Brain, Loader2, Pencil, Trash2, Plus, RotateCw, TriangleAlert, Info, X, Check, ChevronDown,
  Search, Layers, RefreshCw, Scissors, Zap, FolderTree,
} from 'lucide-react';
import {
  KNOWLEDGE_KINDS, ABOUT_CATEGORIES, POINT_CATEGORIES, PATTERN_CATEGORIES, PATTERN_PLATFORMS,
  GUIDANCE_CATEGORIES, knowledgeStatus, knowledgeCoverage, itemLooksCutOff, looksLikeMechanicsDump,
  materialsNeedingDissection,
} from '@/lib/applicantKnowledge';
// The jobs themselves (rebuildApplicantKnowledge, extendApplicantKnowledge,
// refreshApplicantKnowledge, dissectMaterialKnowledge) run as background tasks
// through knowledgeService, so leaving this page never cancels one.
import {
  readKnowledgeSources, runningKnowledgeTask, startKnowledgeRebuild, startKnowledgeExtend,
  startKnowledgeRefresh, startKnowledgeDissection,
} from '@/lib/knowledgeService';
import {
  runKnowledgeMaintenance, scheduleKnowledgeAutoRefresh, subscribeKnowledgeAutoRefresh, knowledgeAutoRefreshBlocker,
} from '@/lib/knowledgeAutoRefresh';
import { useBackgroundTasks } from '@/hooks/use-background-tasks';
import { getKnowledgeAutoUpdate, setKnowledgeAutoUpdate } from '@/lib/persist';

const CATEGORIES = {
  brief: ABOUT_CATEGORIES,
  evidence: POINT_CATEGORIES,
  pattern: PATTERN_CATEGORIES,
  guidance: GUIDANCE_CATEGORIES,
};

const EMPTY_DRAFT = {
  kind: 'brief', category: 'personality', text: '', source_label: '', platform: 'General',
  target_university_id: '', target_essay_id: '', target_platform: '', target_task: '',
};

const formatDate = (iso) => {
  if (!iso) return '';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString();
};

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

function ItemRow({ item, onEdit, onDelete, editing, draft, setDraft, onSave, onCancel, showPlatform, universities, essays }) {
  const categoryLabel = CATEGORIES[item.kind]?.[item.category] || item.category;
  if (editing) {
    return (
      <li className="bg-card border border-border rounded-xl p-4 space-y-3">
        <div className="flex flex-wrap gap-2">
          <Select value={draft.category} onValueChange={(v) => setDraft({ ...draft, category: v })}>
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              {Object.entries(CATEGORIES[item.kind]).map(([value, label]) => (
                <SelectItem key={value} value={value}>{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {showPlatform && (
            <Select value={draft.platform} onValueChange={(v) => setDraft({ ...draft, platform: v })}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.keys(PATTERN_PLATFORMS).map((p) => (
                  <SelectItem key={p} value={p}>{p}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
        <Textarea value={draft.text} onChange={(e) => setDraft({ ...draft, text: e.target.value })} rows={3} />
        {(item.kind === 'evidence' || item.kind === 'guidance') && (
          <Input value={draft.source_label} onChange={(e) => setDraft({ ...draft, source_label: e.target.value })} placeholder={item.kind === 'guidance' ? 'Which guide or reference this comes from' : 'Where this comes from, e.g. Robotics material'} />
        )}
        <ContextTargetFields
          value={draft}
          universities={universities}
          essays={essays}
          onChange={(patch) => setDraft((current) => ({ ...current, ...patch }))}
        />
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={onSave} disabled={!draft.text.trim()}>
            <Check className="w-3.5 h-3.5 mr-1.5" /> Save
          </Button>
          <Button size="sm" variant="ghost" onClick={onCancel}>
            <X className="w-3.5 h-3.5 mr-1.5" /> Cancel
          </Button>
          <span className="text-[11px] text-foreground/40 ml-auto">Saving makes this an item you wrote.</span>
        </div>
      </li>
    );
  }
  const flagged = item.origin === 'ai' && !item.data?.dissected && looksLikeMechanicsDump(item.text);
  const section = item.data?.dissected ? String(item.data.section || '') : '';
  return (
    <li className="group bg-card border border-border rounded-xl p-4 flex items-start gap-3">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap mb-1">
          <Badge variant="outline" className="h-5 px-1.5 text-[10px]">{categoryLabel}</Badge>
          {showPlatform && <Badge variant="outline" className="h-5 px-1.5 text-[10px]">{item.platform || 'General'}</Badge>}
          <span className={`text-[10px] uppercase tracking-wide ${item.origin === 'manual' ? 'text-accent' : 'text-foreground/35'}`}>
            {item.origin === 'manual' ? 'You wrote this' : item.data?.revised_at ? 'Built by AI · revised' : 'Built by AI'}
          </span>
          {section && (
            <Badge variant="outline" className="h-5 px-1.5 text-[10px] text-foreground/60 gap-1" title="Filed from one section of a material">
              <FolderTree className="w-2.5 h-2.5" />{section}
            </Badge>
          )}
          {(() => {
            const target = contextTargetLabel(item, { universities, essays });
            return target !== 'All applications and tasks' ? (
              <Badge variant="outline" className="h-5 px-1.5 text-[10px] text-accent border-accent/25 bg-accent/5">{target}</Badge>
            ) : null;
          })()}
        </div>
        <p className="text-sm text-foreground/75 leading-relaxed">{item.text}</p>
        {itemLooksCutOff(item.text) && (
          <p className="text-[11px] text-amber-700 mt-1 flex items-start gap-1.5">
            <TriangleAlert className="w-3 h-3 mt-0.5 shrink-0" />
            This item ends mid-sentence. Atlas never finishes a sentence for you — edit it so the drafter gets the whole thought.
          </p>
        )}
        {flagged && (
          <p className="text-[11px] text-amber-700 mt-1 flex items-start gap-1.5">
            <TriangleAlert className="w-3 h-3 mt-0.5 shrink-0" />
            Reads like assessment detail (an IA, a grade, a trial number) rather than something about you as a person.
            “Refresh” re-examines it and rewrites or removes it; or edit it yourself into what it shows about you.
          </p>
        )}
        {(item.kind === 'evidence' || item.kind === 'guidance') && item.source_label && (
          <p className="text-[11px] text-foreground/40 mt-1">Source: {item.source_label}</p>
        )}
      </div>
      <div className="flex items-center gap-1 shrink-0 opacity-60 group-hover:opacity-100 transition">
        <button onClick={onEdit} className="p-1.5 rounded text-foreground/35 hover:text-foreground hover:bg-muted" title="Edit (this becomes an item you wrote)">
          <Pencil className="w-3.5 h-3.5" />
        </button>
        <button onClick={onDelete} className="p-1.5 rounded text-foreground/35 hover:text-destructive hover:bg-destructive/5" title="Remove">
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </li>
  );
}

export default function AiKnowledge() {
  const [rows, setRows] = useState([]);
  const [inputs, setInputs] = useState(null);
  const [universities, setUniversities] = useState([]);
  const [essays, setEssays] = useState([]);
  const [targetScopeLocalOnly, setTargetScopeLocalOnly] = useState(false);
  const [collapsedSections, setCollapsedSections] = useState(/** @type {Record<string, boolean>} */ ({}));
  const [loading, setLoading] = useState(true);
  const [tableMissing, setTableMissing] = useState(false);
  const [materials, setMaterials] = useState([]);
  const [editingId, setEditingId] = useState(null);
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [adding, setAdding] = useState(false);
  const [patternFilter, setPatternFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [autoUpdate, setAutoUpdate] = useState(() => getKnowledgeAutoUpdate());
  /** The last automatic pass this page heard about: what it did, or why it did nothing. */
  const [autoEvent, setAutoEvent] = useState(null);
  const [checking, setChecking] = useState(false);
  const modelReady = hasLiveModel();

  /** Reads the applicant's sources (profile, materials, drafts) and the saved items. */
  const readSources = useCallback(() => readKnowledgeSources(), []);

  const load = useCallback(async ({ quiet = false } = {}) => {
    try {
      const {
        inputs: sources, items, missing, universities: universityRows, essays: essayRows, materials: materialRows,
        targetScopeLocalOnly: localScope,
      } = await readSources();
      setInputs(sources);
      setRows(items);
      setUniversities(universityRows);
      setEssays(essayRows);
      setMaterials(materialRows || []);
      setTableMissing(missing);
      setTargetScopeLocalOnly(localScope);
    } catch (e) {
      console.error(e);
      if (!quiet) toast.error('Could not load the AI Knowledge Base', { description: e.message });
    } finally {
      setLoading(false);
    }
  }, [readSources]);

  useEffect(() => { load(); }, [load]);

  // Opening this page is a good moment for a quiet catch-up pass: the applicant
  // is about to read the base, so it should reflect what they saved elsewhere.
  useEffect(() => { scheduleKnowledgeAutoRefresh('knowledge page opened', { delayMs: 5000 }); }, []);

  // Jobs run as background tasks, so one started on an earlier visit (or by the
  // automatic update) is shown here and its result is loaded when it lands.
  const onTaskChange = useCallback((task) => {
    if (task.kind !== 'knowledge' || task.state === 'running') return;
    if (task.state === 'done' || task.state === 'failed') load({ quiet: true });
  }, [load]);
  const tasks = useBackgroundTasks(onTaskChange);
  const knowledgeTask = tasks.find((task) => task.kind === 'knowledge' && task.state === 'running') || runningKnowledgeTask();
  const busy = knowledgeTask?.stage || null;

  useEffect(() => subscribeKnowledgeAutoRefresh((event) => {
    setAutoEvent({ ...event, at: Date.now() });
    if (event.type === 'finished') load({ quiet: true });
  }), [load]);

  const status = knowledgeStatus(rows, inputs?.fingerprint);
  const byKind = (kind) => rows.filter((r) => r.kind === kind)
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  const pendingDissection = useMemo(() => materialsNeedingDissection(materials, rows), [materials, rows]);

  const rebuildBlocker = (() => {
    if (tableMissing) return 'The database table is missing. Run supabase/schema.sql once, then come back.';
    if (!modelReady) return 'Connect an AI provider in AI setup (the AI status in the sidebar). Demo mode will not invent a profile.';
    if (!inputs || inputs.empty) return 'Add a profile, a material, or an essay draft first. Atlas builds this from what you have entered.';
    return '';
  })();

  /**
   * Starts one knowledge job as a background task and reports its outcome
   * here if the page is still open. `start` is one of the knowledgeService
   * starters; the task keeps running if the applicant leaves the page.
   */
  const runJob = async (start, { title, onDone }) => {
    if (rebuildBlocker) return;
    let promise;
    try {
      ({ promise } = start({ owner: 'knowledge-page' }));
    } catch (e) {
      if (e?.code === 'knowledge_busy') {
        toast.message('One job at a time', { description: e.message });
        return;
      }
      notifyAIError(e, title);
      return;
    }
    try {
      const outcome = await promise;
      await load({ quiet: true });
      onDone(outcome);
    } catch (e) {
      notifyAIError(e, title);
    }
  };

  const handleRebuild = async () => {
    if (rebuildBlocker) return;
    if (status.built && !window.confirm(
      'Rebuild rewrites every item Atlas built for the portrait from scratch. Items you wrote and sections filed from materials are kept, '
      + 'but a good AI item can come back worded differently or not at all.\n\n“Refresh” re-examines the items one by one instead, '
      + 'and keeps what still holds. Rebuild anyway?',
    )) return;
    await runJob(startKnowledgeRebuild, {
      title: 'Could not rebuild the knowledge base',
      onDone: (outcome) => {
        toast.success('AI knowledge base rebuilt', {
          description: `${plural(outcome.counts.brief, 'item')} about you, ${plural(outcome.counts.evidence, 'personal point')}, ${plural(outcome.counts.pattern, 'pattern')}, and ${plural(outcome.counts.guidance || 0, 'guidance item')}.`,
        });
        for (const warning of outcome.warnings) toast.warning('Some items were kept', { description: warning });
      },
    });
  };

  /**
   * “Refresh”: the maintenance pass. Every AI item is re-examined against the
   * sources as they are now and kept, revised, or removed one by one; then
   * only what is missing is added. Nothing is rebuilt, so a good point
   * survives a stale one being fixed.
   */
  const handleRefresh = async () => {
    await runJob(startKnowledgeRefresh, {
      title: 'Could not refresh the knowledge base',
      onDone: (outcome) => {
        const c = outcome.counts || {};
        if (!c.revised && !c.removed && !c.added) {
          toast.message('Already current', { description: outcome.warnings[0] || `Every one of the ${plural(c.kept || 0, 'item')} still holds.` });
        } else {
          toast.success('Knowledge base refreshed', {
            description: `${plural(c.revised || 0, 'item')} rewritten · ${c.removed || 0} removed · ${c.added || 0} added · ${c.kept || 0} kept as they were.`,
          });
        }
        for (const warning of outcome.warnings.slice(0, 3)) toast.warning('Note', { description: warning });
      },
    });
  };

  /**
   * “Go deeper”: read the same sources again and APPEND what the first pass
   * missed. Nothing is removed, so a half-built portrait is never destroyed by
   * trying to finish it. A portrait built from forty documents is meant to be
   * long — this is the path that lets it grow without losing what is there.
   */
  const handleGoDeeper = async () => {
    await runJob(startKnowledgeExtend, {
      title: 'Could not extend the knowledge base',
      onDone: (outcome) => {
        const added = outcome.counts.about + outcome.counts.points + outcome.counts.patterns + outcome.counts.guidance;
        if (added) {
          toast.success(`${added} more item${added === 1 ? '' : 's'} saved`, {
            description: `${outcome.counts.about} about you · ${outcome.counts.points} personal points · ${outcome.counts.patterns} patterns · ${outcome.counts.guidance} guidance. Nothing you already had was changed.`,
          });
        } else {
          toast.message('Nothing new to add', { description: outcome.warnings[0] || 'The sources hold nothing the portrait does not already have.' });
        }
        for (const warning of outcome.warnings.filter((text) => !text.startsWith('The model found nothing'))) {
          toast.warning('Partly done', { description: warning });
        }
      },
    });
  };

  /** Files each unfiled material into sections (school, essay kind, platform, task). */
  const handleDissect = async () => {
    await runJob((options) => startKnowledgeDissection({ ...options, limit: 4 }), {
      title: 'Could not file the materials into sections',
      onDone: (outcome) => {
        const filed = (outcome.done || []).reduce((sum, item) => sum + (item.rows || 0), 0);
        const named = (outcome.done || []).map((item) => item.title).join(', ');
        if (filed) {
          toast.success(`${plural(filed, 'section item')} filed`, {
            description: `${named}. ${outcome.skipped ? `${plural(outcome.skipped, 'material')} still waiting — press again.` : 'Drafts now read only the sections that match their school and essay.'}`,
          });
        } else {
          toast.message('Nothing new to file', { description: outcome.warnings[0] || 'These materials hold no part that belongs to one school or one essay.' });
        }
        for (const warning of (outcome.warnings || []).slice(0, 3)) toast.warning('Note', { description: warning });
      },
    });
  };

  /** The automatic pass, run now instead of on its timer. */
  const handleUpdateNow = async () => {
    setChecking(true);
    try {
      const result = await runKnowledgeMaintenance({ force: true, reason: 'update now' });
      await load({ quiet: true });
      if (result.ran.length) {
        toast.success('Knowledge base updated', { description: `Ran: ${result.ran.join(', ')}.` });
      } else {
        toast.message('Nothing to do', { description: result.skipped || 'The knowledge base is already current.' });
      }
    } catch (e) {
      notifyAIError(e, 'The update could not run');
    } finally {
      setChecking(false);
    }
  };

  const toggleAutoUpdate = (value) => {
    setKnowledgeAutoUpdate(value);
    setAutoUpdate(value);
    if (value) scheduleKnowledgeAutoRefresh('automatic updates switched on', { delayMs: 3000 });
  };

  const startEdit = (item) => {
    setAdding(false);
    setEditingId(item.id);
    setDraft({
      kind: item.kind,
      category: item.category,
      text: item.text,
      source_label: item.source_label || '',
      platform: item.platform || 'General',
      target_university_id: item.target_university_id || '',
      target_essay_id: item.target_essay_id || '',
      target_platform: item.target_platform || '',
      target_task: item.target_task || '',
    });
  };

  const startAdd = () => {
    setEditingId(null);
    setAdding(true);
    setDraft(EMPTY_DRAFT);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setAdding(false);
    setDraft(EMPTY_DRAFT);
  };

  const saveItem = async () => {
    const text = draft.text.trim();
    if (!text) return;
    const fields = {
      kind: draft.kind,
      category: draft.category,
      text,
      origin: 'manual',
      source_label: draft.source_label.trim() || 'Added by you',
      platform: draft.kind === 'pattern' ? draft.platform : 'General',
      ...contextTargetFields(draft),
    };
    try {
      if (editingId) {
        const saved = await base44.entities.ApplicantKnowledge.update(editingId, fields);
        if (!saved) {
          const refreshed = await base44.entities.ApplicantKnowledge.list().catch(() => null);
          if (refreshed) setRows(refreshed);
          throw new Error('Atlas could not confirm the update. Check the refreshed list before retrying.');
        }
        setRows((prev) => prev.map((r) => (r.id === editingId ? { ...r, ...saved } : r)));
        toast.success('Saved');
      } else {
        const saved = await base44.entities.ApplicantKnowledge.create({ ...fields, sort_order: rows.length });
        if (!saved) {
          const refreshed = await base44.entities.ApplicantKnowledge.list().catch(() => null);
          if (refreshed) setRows(refreshed);
          throw new Error('Atlas could not confirm whether this entry was added. Check the list before retrying to avoid a duplicate.');
        }
        setRows((prev) => [...prev, saved]);
        toast.success('Added');
      }
      cancelEdit();
    } catch (e) {
      toast.error('Could not save this item', { description: e.message });
    }
  };

  const removeItem = async (item) => {
    if (!window.confirm('Remove this item? Atlas will stop using it in drafts and reviews.')) return;
    try {
      await base44.entities.ApplicantKnowledge.delete(item.id);
      setRows((prev) => prev.filter((r) => r.id !== item.id));
      toast.success('Removed');
    } catch (e) {
      toast.error('Could not remove this item', { description: e.message });
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32">
        <div className="w-8 h-8 border-2 border-border border-t-foreground rounded-full animate-spin" />
      </div>
    );
  }

  const patterns = byKind('pattern').filter((r) => patternFilter === 'all' || r.platform === patternFilter);
  const sourceCounts = inputs?.counts || { profile: 0, materials: 0, samples: 0, guidance: 0, essays: 0 };

  const matchesQuery = (item) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return `${item.text || ''} ${item.source_label || ''}`.toLowerCase().includes(q);
  };
  const coverage = knowledgeCoverage(rows, inputs);
  // Sections filed from materials, grouped by material then section, so the
  // applicant can see how a document was dissected and jump to one part of it.
  const filedSections = (() => {
    const byMaterial = new Map();
    for (const row of rows) {
      if (!row.data?.dissected) continue;
      const materialTitle = String(row.source_label || '').split(' · ')[0] || 'Material';
      const key = String(row.source_id || materialTitle);
      if (!byMaterial.has(key)) byMaterial.set(key, { key, title: materialTitle, sections: new Map() });
      const material = byMaterial.get(key);
      const label = String(row.data.section || 'Section');
      if (!material.sections.has(label)) {
        material.sections.set(label, { label, sourceLabel: row.source_label || '', count: 0, kinds: new Set(), target: contextTargetLabel(row, { universities, essays }) });
      }
      const section = material.sections.get(label);
      section.count += 1;
      section.kinds.add(row.kind);
    }
    return [...byMaterial.values()].map((material) => ({ ...material, sections: [...material.sections.values()] }));
  })();
  // Which part of the "thin build" warning belongs to which section, so the
  // notice sits next to the list it is about instead of in a banner nobody reads.
  const THIN_LABEL = { brief: 'About you', evidence: 'Personal points', pattern: 'Patterns', guidance: 'Guidance' };
  const thinFor = (kind) => coverage.thin.includes(THIN_LABEL[kind]);

  const renderSection = (kind, items, extra = null) => {
    const collapsed = !!collapsedSections[kind];
    const visible = items.filter(matchesQuery);
    const table = CATEGORIES[kind] || {};
    const grouped = Object.keys(table)
      .map((category) => ({ category, rows: visible.filter((item) => item.category === category) }))
      .filter((group) => group.rows.length);
    const uncategorised = visible.filter((item) => !table[item.category]);
    if (uncategorised.length) grouped.push({ category: 'other', rows: uncategorised });
    return (
      <section className="rounded-xl border border-border bg-card overflow-hidden">
        <button
          type="button"
          onClick={() => setCollapsedSections((prev) => ({ ...prev, [kind]: !prev[kind] }))}
          className="w-full flex items-center gap-3 p-4 text-left hover:bg-muted/30 transition"
          aria-expanded={!collapsed}
        >
          <div className="flex-1 min-w-0">
            <h2 className="font-display text-lg font-semibold">{KNOWLEDGE_KINDS[kind].label}</h2>
            <p className="text-xs text-foreground/40">{KNOWLEDGE_KINDS[kind].hint}</p>
          </div>
          {thinFor(kind) && !collapsed && (
            <Badge variant="outline" className="shrink-0 h-5 px-1.5 text-[10px] text-amber-700 border-amber-300 bg-amber-50">
              thinner than your {coverage.sources} source{coverage.sources === 1 ? '' : 's'} support
            </Badge>
          )}
          <Badge variant="outline" className="shrink-0">
            {query.trim() ? `${visible.length} of ${items.length}` : `${items.length} ${items.length === 1 ? 'entry' : 'entries'}`}
          </Badge>
          <ChevronDown className={`w-4 h-4 text-foreground/45 transition-transform ${collapsed ? '-rotate-90' : ''}`} />
        </button>
        {!collapsed && (
          <div className="border-t border-border p-4 pt-3 space-y-4">
            {extra}
            {items.length === 0 ? (
              <p className="text-sm text-foreground/35 border border-dashed border-border rounded-xl p-4">Nothing here yet.</p>
            ) : visible.length === 0 ? (
              <p className="text-sm text-foreground/35 border border-dashed border-border rounded-xl p-4">
                No entry in this section matches “{query.trim()}”.
              </p>
            ) : (
              grouped.map((group) => (
                <div key={group.category} className="space-y-2">
                  <h3 className="text-[10px] uppercase tracking-wide text-foreground/35 flex items-center gap-1.5">
                    <Layers className="w-3 h-3" />
                    {table[group.category] || 'Other'}
                    <span className="text-foreground/25">{group.rows.length}</span>
                  </h3>
                  <ul className="space-y-2">
                    {group.rows.map((item) => (
                      <ItemRow
                        key={item.id}
                        item={item}
                        universities={universities}
                        essays={essays}
                        showPlatform={kind === 'pattern'}
                        editing={editingId === item.id}
                        draft={draft}
                        setDraft={setDraft}
                        onEdit={() => startEdit(item)}
                        onDelete={() => removeItem(item)}
                        onSave={saveItem}
                        onCancel={cancelEdit}
                      />
                    ))}
                  </ul>
                </div>
              ))
            )}
          </div>
        )}
      </section>
    );
  };

  return (
    <div className="space-y-8">
      <div className="max-w-3xl">
        <h1 className="font-display text-3xl font-semibold tracking-tight flex items-center gap-3">
          <Brain className="w-7 h-7 text-foreground/40" /> AI Knowledge Base
        </h1>
        <p className="text-foreground/50 mt-1.5 leading-relaxed">
          What Atlas understands about you — the kind of person you are, how you act, what you care about and why — plus what successful
          applications do well and what your tips/reference sources teach. Essay drafts, reviews, and the full application review read it.
          It is kept to your account, you can edit or remove anything, and it keeps itself current in the background. It is separate from
          <span className="text-foreground/65"> University Research</span>, which is about schools.
        </p>
      </div>

      {targetScopeLocalOnly && (
        <div className="flex items-start gap-3 p-4 rounded-xl bg-amber-50 border border-amber-200">
          <TriangleAlert className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
          <p className="text-xs text-amber-800 leading-relaxed">
            This Supabase schema is missing context-target columns. Atlas keeps university, essay, platform, and task scopes in this browser until you run <span className="font-mono">supabase/schema.sql</span>.
          </p>
        </div>
      )}

      {tableMissing && (
        <div className="flex items-start gap-3 p-4 rounded-xl bg-amber-50 border border-amber-200">
          <TriangleAlert className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          <div className="text-sm text-amber-800 space-y-1">
            <p className="font-medium">This feature needs one database table.</p>
            <p className="text-amber-700/90">
              In Supabase, open the SQL editor and run <span className="font-mono">supabase/schema.sql</span> once. It is safe to run again.
              Until then, drafts and reviews work as before, without this knowledge.
            </p>
          </div>
        </div>
      )}

      <div className="bg-card border border-border rounded-xl p-5 space-y-4">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="space-y-1">
            <p className="text-sm font-medium">
              {status.built
                ? `Built ${formatDate(status.builtAt) || 'earlier'}${status.refreshedAt ? ` · re-examined ${formatDate(status.refreshedAt)}` : ''}`
                : 'Not built yet'}
            </p>
            {busy && (
              <p className="text-xs text-accent flex items-center gap-1.5">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                {knowledgeTask?.label || 'Working'}{knowledgeTask?.detail ? ` — ${knowledgeTask.detail}` : ''}. You can leave this page; it keeps running.
              </p>
            )}
            <p className="text-xs text-foreground/45">
              Sources: {sourceCounts.profile ? 'your profile' : 'no profile'} · {plural(sourceCounts.materials, 'evidence material')} · {plural(sourceCounts.guidance, 'guide/reference')} · {plural(sourceCounts.samples, 'sample essay')} · {plural(sourceCounts.essays, 'essay draft')}
            </p>
            {status.built && (
              <p className="text-xs text-foreground/45">
                {plural(status.counts.brief, 'item')} about you · {plural(status.counts.evidence, 'personal point')} · {plural(status.counts.pattern, 'pattern')} · {plural(status.counts.guidance, 'guidance item')}
                {' · from '}{plural(coverage.sources, 'source')}
                {` · about you: ${['personality', 'actions', 'mindset', 'goals'].map((key) => `${coverage.about[key] || 0} ${key}`).join(', ')}`}
              </p>
            )}
            {coverage.thin.length > 0 && (
              <p className="text-[11px] text-amber-700 flex items-start gap-1.5 mt-1 max-w-2xl">
                <Info className="w-3.5 h-3.5 mt-px shrink-0" />
                {coverage.thin.join(', ')} {coverage.thin.length === 1 ? 'is' : 'are'} thinner than these materials can support
                {coverage.thin.includes('Patterns') ? ' for the samples you added' : ''}
                {coverage.thin.includes('Guidance') ? ' for the guides and references you added' : ''}. Press “Go deeper” to append the rest — a rebuild rewrites, this only adds.
              </p>
            )}
            {coverage.cutOff > 0 && (
              <p className="text-[11px] text-red-700/80 flex items-start gap-1.5 mt-1">
                <TriangleAlert className="w-3.5 h-3.5 mt-px shrink-0" />
                {plural(coverage.cutOff, 'item')} {coverage.cutOff === 1 ? 'ends' : 'end'} mid-sentence and {coverage.cutOff === 1 ? 'is' : 'are'} marked below. Finish {coverage.cutOff === 1 ? 'it' : 'them'}: a drafter cannot use half a thought.
              </p>
            )}
            {status.stale && (
              <p className="text-xs text-amber-700 flex items-center gap-1.5 mt-1">
                <Info className="w-3.5 h-3.5" />
                Your profile, materials, or drafts changed since this was built.
                {autoUpdate && modelReady ? ' Atlas will re-examine it on its own shortly; “Refresh” does it now.' : ' Press “Refresh” to re-examine it item by item.'}
              </p>
            )}
            {status.flagged > 0 && (
              <p className="text-xs text-amber-700 flex items-center gap-1.5 mt-1">
                <TriangleAlert className="w-3.5 h-3.5" />
                {plural(status.flagged, 'item')} read{status.flagged === 1 ? 's' : ''} like assessment detail rather than a person
                {' '}(marked below). “Refresh” rewrites or removes {status.flagged === 1 ? 'it' : 'them'}.
              </p>
            )}
            {pendingDissection.length > 0 && (
              <p className="text-xs text-foreground/55 flex items-center gap-1.5 mt-1">
                <Scissors className="w-3.5 h-3.5" />
                {plural(pendingDissection.length, 'material')} {pendingDissection.length === 1 ? 'has' : 'have'} not been filed into sections yet
                {autoUpdate && modelReady ? ' — Atlas files them in the background, two per pass.' : '.'}
              </p>
            )}
            {status.dissected > 0 && (
              <p className="text-[11px] text-foreground/40 flex items-center gap-1.5 mt-1">
                <FolderTree className="w-3.5 h-3.5" />
                {plural(status.dissected, 'item')} filed from sections of your materials — a draft reads only the sections that match its school and essay.
              </p>
            )}
          </div>
          <div className="flex flex-col items-end gap-1.5">
            <div className="flex items-center gap-2 flex-wrap justify-end">
              {status.built && (
                <Button onClick={handleRefresh} disabled={!!rebuildBlocker || !!busy}>
                  {busy === 'refresh' ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}
                  {busy === 'refresh' ? 'Re-examining…' : 'Refresh'}
                </Button>
              )}
              {status.built && (
                <Button variant="outline" onClick={handleGoDeeper} disabled={!!rebuildBlocker || !!busy}>
                  {busy === 'extend' ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Plus className="w-4 h-4 mr-2" />}
                  {busy === 'extend' ? 'Reading again…' : 'Go deeper'}
                </Button>
              )}
              {pendingDissection.length > 0 && (
                <Button variant="outline" onClick={handleDissect} disabled={!!rebuildBlocker || !!busy}>
                  {busy === 'dissect' ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Scissors className="w-4 h-4 mr-2" />}
                  {busy === 'dissect' ? 'Filing…' : `File ${pendingDissection.length} material${pendingDissection.length === 1 ? '' : 's'} into sections`}
                </Button>
              )}
              <Button variant={status.built ? 'ghost' : 'default'} onClick={handleRebuild} disabled={!!rebuildBlocker || !!busy}>
                {busy === 'rebuild' ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RotateCw className="w-4 h-4 mr-2" />}
                {busy === 'rebuild' ? 'Reading your file…' : status.built ? 'Rebuild from scratch' : 'Build from my profile and materials'}
              </Button>
            </div>
            {rebuildBlocker && !busy && (
              <p className="text-[11px] text-foreground/40 max-w-xs text-right">{rebuildBlocker}</p>
            )}
            {status.built && !rebuildBlocker && (
              <p className="text-[11px] text-foreground/35 max-w-sm text-right">
                “Refresh” examines each item one by one and keeps, rewrites, or removes it, then adds only what is missing.
                “Go deeper” only adds. “Rebuild” starts the portrait over — items you wrote and filed sections are kept either way.
              </p>
            )}
          </div>
        </div>

        <div className="border-t border-border pt-4 flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-start gap-3">
            <Switch
              id="knowledge-auto-update"
              checked={autoUpdate}
              onCheckedChange={toggleAutoUpdate}
              disabled={tableMissing}
            />
            <div>
              <label htmlFor="knowledge-auto-update" className="text-sm font-medium flex items-center gap-1.5 cursor-pointer">
                <Zap className="w-3.5 h-3.5 text-accent" /> Keep this up to date automatically
              </label>
              <p className="text-[11px] text-foreground/45 leading-relaxed max-w-xl mt-0.5">
                When your profile, a material, or a draft changes, Atlas waits for your own AI work to finish, then files new
                materials into sections and re-examines the items in the background. Nothing is rebuilt and nothing you wrote is touched.
                {!modelReady && ' It needs a connected AI model.'}
              </p>
              {autoEvent && (
                <p className="text-[11px] text-foreground/40 mt-1">
                  Last automatic pass ({autoEvent.reason}{autoEvent.at ? `, ${new Date(autoEvent.at).toLocaleTimeString()}` : ''}):{' '}
                  {autoEvent.type === 'started' ? 'running…'
                    : autoEvent.type === 'finished' ? `done — ${(Array.isArray(autoEvent.detail) && autoEvent.detail.length) ? autoEvent.detail.join(', ') : 'nothing needed changing'}`
                      : autoEvent.type === 'failed' ? `stopped: ${String(autoEvent.detail?.message || autoEvent.detail || 'unknown error')}`
                        : `skipped — ${String(autoEvent.detail || '')}`}
                </p>
              )}
              {!autoEvent && autoUpdate && knowledgeAutoRefreshBlocker() && (
                <p className="text-[11px] text-foreground/40 mt-1">Waiting: {knowledgeAutoRefreshBlocker()}</p>
              )}
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={handleUpdateNow} disabled={!!rebuildBlocker || !!busy || checking}>
            {checking ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Zap className="w-3.5 h-3.5 mr-1.5" />}
            {checking ? 'Checking…' : 'Update now'}
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-56 max-w-md">
          <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-foreground/35" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search every item in the knowledge base"
            className="pl-8"
            aria-label="Search the AI knowledge base"
          />
        </div>
        {query.trim() && (
          <Button variant="ghost" size="sm" onClick={() => setQuery('')}>Clear</Button>
        )}
      </div>

      {filedSections.length > 0 && (
        <section className="rounded-xl border border-border bg-card overflow-hidden">
          <button
            type="button"
            onClick={() => setCollapsedSections((prev) => ({ ...prev, filed: !prev.filed }))}
            className="w-full flex items-center gap-3 p-4 text-left hover:bg-muted/30 transition"
            aria-expanded={!collapsedSections.filed}
          >
            <div className="flex-1 min-w-0">
              <h2 className="font-display text-lg font-semibold flex items-center gap-2">
                <FolderTree className="w-4 h-4 text-foreground/40" /> Sections filed from your materials
              </h2>
              <p className="text-xs text-foreground/40">
                Each material is dissected into the parts that belong to one school, one essay type, or one task. A draft
                reads only the parts that match it; the full application review reads the school sections for fit.
              </p>
            </div>
            <Badge variant="outline" className="shrink-0">{plural(filedSections.length, 'material')}</Badge>
            <ChevronDown className={`w-4 h-4 text-foreground/45 transition-transform ${collapsedSections.filed ? '-rotate-90' : ''}`} />
          </button>
          {!collapsedSections.filed && (
            <div className="border-t border-border p-4 pt-3 grid sm:grid-cols-2 gap-3">
              {filedSections.map((material) => (
                <div key={material.key} className="rounded-lg border border-border p-3">
                  <p className="text-xs font-medium text-foreground/75 truncate" title={material.title}>{material.title}</p>
                  <ul className="mt-2 space-y-1">
                    {material.sections.map((section) => (
                      <li key={section.label}>
                        <button
                          type="button"
                          onClick={() => setQuery(query === section.sourceLabel ? '' : section.sourceLabel)}
                          className={`w-full text-left text-[11px] rounded-md px-2 py-1 flex items-center gap-2 hover:bg-muted/50 ${query === section.sourceLabel ? 'bg-accent/10 text-accent' : 'text-foreground/60'}`}
                          title="Show only this section's items"
                        >
                          <span className="flex-1 truncate">{section.label}</span>
                          {section.target && section.target !== 'All applications and tasks' && (
                            <span className="text-[10px] text-foreground/40 truncate max-w-[40%]">{section.target}</span>
                          )}
                          <span className="font-mono text-foreground/35">{section.count}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {renderSection('brief', byKind('brief'))}

      {renderSection('evidence', byKind('evidence'))}

      {renderSection('pattern', patterns, (
        <div className="flex items-center gap-2 text-xs text-foreground/50">
          <span>Show:</span>
          {['all', 'US', 'UK', 'General'].map((value) => (
            <button
              key={value}
              onClick={() => setPatternFilter(value)}
              className={`px-2.5 py-1 rounded-full border text-[11px] ${patternFilter === value ? 'border-foreground/40 text-foreground' : 'border-border text-foreground/45 hover:text-foreground/70'}`}
            >
              {value === 'all' ? 'All platforms' : value}
            </button>
          ))}
        </div>
      ))}

      {renderSection('guidance', byKind('guidance'))}

      <section className="space-y-3">
        {adding && !editingId ? (
          <div className="bg-card border border-border rounded-xl p-4 space-y-3">
            <div className="flex flex-wrap gap-2">
              <Select value={draft.kind} onValueChange={(kind) => setDraft({ ...draft, kind, category: Object.keys(CATEGORIES[kind])[0] })}>
                <SelectTrigger className="w-64"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(KNOWLEDGE_KINDS).map(([value, meta]) => (
                    <SelectItem key={value} value={value}>{meta.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={draft.category} onValueChange={(category) => setDraft({ ...draft, category })}>
                <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(CATEGORIES[draft.kind]).map(([value, label]) => (
                    <SelectItem key={value} value={value}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {draft.kind === 'pattern' && (
                <Select value={draft.platform} onValueChange={(platform) => setDraft({ ...draft, platform })}>
                  <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.keys(PATTERN_PLATFORMS).map((p) => (
                      <SelectItem key={p} value={p}>{p}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
            <Textarea
              value={draft.text}
              onChange={(e) => setDraft({ ...draft, text: e.target.value })}
              rows={3}
              placeholder={draft.kind === 'pattern'
                ? 'e.g. Open in a concrete scene, then name the cost in the second sentence.'
                : draft.kind === 'evidence'
                  ? 'e.g. Ran the robotics club budget for 14 students across three sponsors.'
                  : 'e.g. Tends to take on work nobody asked for, and is honest when it goes wrong.'}
            />
            {draft.kind !== 'pattern' && (
              <Input value={draft.source_label} onChange={(e) => setDraft({ ...draft, source_label: e.target.value })} placeholder="Where this comes from (optional)" />
            )}
            <ContextTargetFields
              value={draft}
              universities={universities}
              essays={essays}
              onChange={(patch) => setDraft((current) => ({ ...current, ...patch }))}
            />
            <div className="flex items-center gap-2">
              <Button size="sm" onClick={saveItem} disabled={!draft.text.trim()}>
                <Plus className="w-3.5 h-3.5 mr-1.5" /> Add item
              </Button>
              <Button size="sm" variant="ghost" onClick={cancelEdit}>Cancel</Button>
            </div>
          </div>
        ) : (
          <Button variant="outline" onClick={startAdd} disabled={tableMissing}>
            <Plus className="w-4 h-4 mr-2" /> Add an item yourself
          </Button>
        )}
      </section>
    </div>
  );
}
