import { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import { base44 } from '@/api/base44Client';
import { getOllamaConfig } from '@/api/ollamaClient';
import { runAI, notifyAIError } from '@/lib/ai';
import { hasLiveModel, isLiveOutcome } from '@/lib/aiOutcome';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Brain, Loader2, Pencil, Trash2, Plus, RotateCw, TriangleAlert, Info, X, Check,
} from 'lucide-react';
import {
  KNOWLEDGE_KINDS, ABOUT_CATEGORIES, POINT_CATEGORIES, PATTERN_CATEGORIES, PATTERN_PLATFORMS,
  buildKnowledgeInputs, knowledgeStatus, rebuildApplicantKnowledge,
} from '@/lib/applicantKnowledge';

const CATEGORIES = {
  brief: ABOUT_CATEGORIES,
  evidence: POINT_CATEGORIES,
  pattern: PATTERN_CATEGORIES,
};

const EMPTY_DRAFT = { kind: 'brief', category: 'personality', text: '', source_label: '', platform: 'General' };

const MISSING_TABLE = /applicant_knowledge|ApplicantKnowledge|relation .* does not exist|Could not find the table/i;

const formatDate = (iso) => {
  if (!iso) return '';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString();
};

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

function ItemRow({ item, onEdit, onDelete, editing, draft, setDraft, onSave, onCancel, showPlatform }) {
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
        {item.kind === 'evidence' && (
          <Input value={draft.source_label} onChange={(e) => setDraft({ ...draft, source_label: e.target.value })} placeholder="Where this comes from, e.g. Robotics material" />
        )}
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
  return (
    <li className="group bg-card border border-border rounded-xl p-4 flex items-start gap-3">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap mb-1">
          <Badge variant="outline" className="h-5 px-1.5 text-[10px]">{categoryLabel}</Badge>
          {showPlatform && <Badge variant="outline" className="h-5 px-1.5 text-[10px]">{item.platform || 'General'}</Badge>}
          <span className={`text-[10px] uppercase tracking-wide ${item.origin === 'manual' ? 'text-accent' : 'text-foreground/35'}`}>
            {item.origin === 'manual' ? 'You wrote this' : 'Built by AI'}
          </span>
        </div>
        <p className="text-sm text-foreground/75 leading-relaxed">{item.text}</p>
        {item.kind === 'evidence' && item.source_label && (
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
  const [loading, setLoading] = useState(true);
  const [tableMissing, setTableMissing] = useState(false);
  const [rebuilding, setRebuilding] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [adding, setAdding] = useState(false);
  const [patternFilter, setPatternFilter] = useState('all');
  const modelReady = hasLiveModel();

  /** Reads the applicant's sources (profile, materials, drafts) and the saved items. */
  const readSources = useCallback(async () => {
    const [profiles, materials, essays] = await Promise.all([
      base44.entities.Profile.list(),
      base44.entities.Material.list(),
      base44.entities.Essay.list(),
    ]);
    let items = [];
    let missing = false;
    try {
      items = await base44.entities.ApplicantKnowledge.list();
    } catch (error) {
      if (!MISSING_TABLE.test(String(error?.message || error))) throw error;
      missing = true;
    }
    return { inputs: buildKnowledgeInputs({ profile: profiles, materials, essays }), items, missing };
  }, []);

  const load = useCallback(async () => {
    try {
      const { inputs: sources, items, missing } = await readSources();
      setInputs(sources);
      setRows(items);
      setTableMissing(missing);
    } catch (e) {
      console.error(e);
      toast.error('Could not load the AI Knowledge Base', { description: e.message });
    } finally {
      setLoading(false);
    }
  }, [readSources]);

  useEffect(() => { load(); }, [load]);

  const status = knowledgeStatus(rows, inputs?.fingerprint);
  const byKind = (kind) => rows.filter((r) => r.kind === kind)
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));

  const rebuildBlocker = (() => {
    if (tableMissing) return 'The database table is missing. Run supabase/schema.sql once, then come back.';
    if (!modelReady) return 'Connect a local model in AI setup (AI status in the sidebar). Demo mode will not invent a profile.';
    if (!inputs || inputs.empty) return 'Add a profile, a material, or an essay draft first. Atlas builds this from what you have entered.';
    return '';
  })();

  const handleRebuild = async () => {
    if (rebuildBlocker) return;
    setRebuilding(true);
    try {
      // Read the sources again, so the build uses what is saved now.
      const fresh = await readSources();
      const outcome = await rebuildApplicantKnowledge({
        inputs: fresh.inputs,
        existingRows: fresh.items,
        runAI,
        isLive: isLiveOutcome,
        createRows: (items) => base44.entities.ApplicantKnowledge.bulkCreate(items),
        deleteRow: (id) => base44.entities.ApplicantKnowledge.delete(id),
        model: getOllamaConfig()?.model || null,
      });
      await load();
      toast.success('AI knowledge base updated', {
        description: `${plural(outcome.counts.brief, 'item')} about you, ${plural(outcome.counts.evidence, 'personal point')}, ${plural(outcome.counts.pattern, 'pattern')}.`,
      });
      for (const warning of outcome.warnings) toast.warning('Some items were kept', { description: warning });
    } catch (e) {
      notifyAIError(e, 'Could not rebuild the knowledge base');
    } finally {
      setRebuilding(false);
    }
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
    };
    try {
      if (editingId) {
        const saved = await base44.entities.ApplicantKnowledge.update(editingId, fields);
        setRows((prev) => prev.map((r) => (r.id === editingId ? { ...r, ...(saved || fields) } : r)));
        toast.success('Saved');
      } else {
        const saved = await base44.entities.ApplicantKnowledge.create({ ...fields, sort_order: rows.length });
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
  const sourceCounts = inputs?.counts || { profile: 0, materials: 0, samples: 0, essays: 0 };

  const renderSection = (kind, items, extra = null) => (
    <section className="space-y-3">
      <div>
        <h2 className="font-display text-lg font-semibold">{KNOWLEDGE_KINDS[kind].label}</h2>
        <p className="text-xs text-foreground/40">{KNOWLEDGE_KINDS[kind].hint}</p>
      </div>
      {extra}
      {items.length === 0 ? (
        <p className="text-sm text-foreground/35 bg-card border border-dashed border-border rounded-xl p-4">Nothing here yet.</p>
      ) : (
        <ul className="space-y-2">
          {items.map((item) => (
            <ItemRow
              key={item.id}
              item={item}
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
      )}
    </section>
  );

  return (
    <div className="space-y-8">
      <div className="max-w-3xl">
        <h1 className="font-display text-3xl font-semibold tracking-tight flex items-center gap-3">
          <Brain className="w-7 h-7 text-foreground/40" /> AI Knowledge Base
        </h1>
        <p className="text-foreground/50 mt-1.5 leading-relaxed">
          What Atlas understands about you, and what successful applications look like. Essay drafts, reviews, and the full
          application review read it. It is kept to your account, and you can edit or remove anything. It is separate from
          <span className="text-foreground/65"> University Research</span>, which is about schools.
        </p>
      </div>

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
                ? `Built ${formatDate(status.builtAt) || 'earlier'}`
                : 'Not built yet'}
            </p>
            <p className="text-xs text-foreground/45">
              Sources: {sourceCounts.profile ? 'your profile' : 'no profile'} · {plural(sourceCounts.materials, 'material')} · {plural(sourceCounts.samples, 'sample essay')} · {plural(sourceCounts.essays, 'essay draft')}
            </p>
            {status.built && (
              <p className="text-xs text-foreground/45">
                {plural(status.counts.brief, 'item')} about you · {plural(status.counts.evidence, 'personal point')} · {plural(status.counts.pattern, 'pattern')}
              </p>
            )}
            {status.stale && (
              <p className="text-xs text-amber-700 flex items-center gap-1.5 mt-1">
                <Info className="w-3.5 h-3.5" />
                Your profile, materials, or drafts changed since this was built. Rebuild to bring it up to date.
              </p>
            )}
          </div>
          <div className="flex flex-col items-end gap-1.5">
            <Button onClick={handleRebuild} disabled={!!rebuildBlocker || rebuilding}>
              {rebuilding ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RotateCw className="w-4 h-4 mr-2" />}
              {rebuilding ? 'Reading your file…' : status.built ? 'Rebuild' : 'Build from my profile and materials'}
            </Button>
            {rebuildBlocker && !rebuilding && (
              <p className="text-[11px] text-foreground/40 max-w-xs text-right">{rebuildBlocker}</p>
            )}
          </div>
        </div>
        <p className="text-[11px] text-foreground/35 leading-relaxed">
          A rebuild replaces only the items Atlas built before. Items you wrote are never removed by a rebuild, and if the AI returns
          nothing new, your current items stay as they are.
        </p>
      </div>

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
