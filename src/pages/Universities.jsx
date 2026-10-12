import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger, DialogDescription } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, Trash2, ArrowRight, ArrowUp, ArrowDown, GraduationCap, Calendar, Globe, Search, Info } from 'lucide-react';
import { roadmapTemplates } from '@/lib/roadmapTemplate';
import { clearEssayArtifacts, getStored, setStored, removeStored } from '@/lib/persist';
import { daysUntil, startOfLocalDay } from '@/lib/dates';
import {
  PLATFORMS, PLATFORM_VALUES, US_ROUNDS, UK_ROUNDS,
  getUniversityPlatform, findUKUniversityNote, universityNamesMatch,
} from '@/lib/essayScope';

const statusColors = {
  researching: 'bg-foreground/10 text-foreground/50',
  in_progress: 'bg-accent/15 text-accent',
  submitted: 'bg-blue-100 text-blue-700',
  decided: 'bg-green-100 text-green-700',
};

// The old cap of 2 UK universities made a real UCAS application impossible —
// UCAS allows five course choices. The list is only bounded so the board stays
// readable, not to model the actual rules.
const LIST_LIMITS = { US: 40, UK: 12 };
const UNIVERSITY_ORDER_KEY = 'universityCardOrder';

export default function Universities() {
  const [universities, setUniversities] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [essays, setEssays] = useState([]);
  const [loading, setLoading] = useState(true);
  const [reordering, setReordering] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({
    name: '', country: 'US', major: '', application_type: '',
    deadline: '', notes: '', application_platform: 'common_app',
  });

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    try {
      if (typeof base44.capabilities?.probe === 'function') {
        try { await base44.capabilities.probe(); } catch { /* reordering falls back to this browser on older schemas */ }
      }
      const [unis, tsk, ess] = await Promise.all([
        base44.entities.University.list(),
        base44.entities.RoadmapTask.list(),
        base44.entities.Essay.list(),
      ]);
      let localOrder = getStored(UNIVERSITY_ORDER_KEY, []);
      if (!Array.isArray(localOrder)) localOrder = [];
      const localRank = new Map(localOrder.map((id, index) => [id, index]));
      let orderSource = unis;
      const missingColumns = base44.capabilities?.missingOptionalColumns?.() || [];
      if (localOrder.length && !missingColumns.includes('sort_order')) {
        const presentIds = new Set(unis.map((uni) => uni.id));
        const orderIds = [
          ...localOrder.filter((id) => presentIds.has(id)),
          ...unis.filter((uni) => !localRank.has(uni.id)).map((uni) => uni.id),
        ];
        const rank = new Map(orderIds.map((id, index) => [id, index]));
        try {
          const updates = await Promise.all(orderIds.map((id, sort_order) =>
            base44.entities.University.update(id, { sort_order }),
          ));
          if (updates.every(Boolean)) {
            removeStored(UNIVERSITY_ORDER_KEY);
            localOrder = [];
            orderSource = unis.map((uni) => ({ ...uni, sort_order: rank.get(uni.id) }));
          }
        } catch { /* keep the local order until the schema or connection can sync it */ }
      }
      const syncedLocalRank = new Map(localOrder.map((id, index) => [id, index]));
      const ordered = orderSource
        .map((uni, index) => ({
          ...uni,
          sort_order: uni.sort_order !== undefined && uni.sort_order !== null && Number.isFinite(Number(uni.sort_order))
            ? Number(uni.sort_order)
            : index,
          _loadedOrder: index,
        }))
        .sort((a, b) => {
          const aLocal = syncedLocalRank.get(a.id);
          const bLocal = syncedLocalRank.get(b.id);
          if (aLocal !== undefined || bLocal !== undefined) {
            if (aLocal === undefined) return 1;
            if (bLocal === undefined) return -1;
            if (aLocal !== bLocal) return aLocal - bLocal;
          }
          return (a.sort_order - b.sort_order) || (a._loadedOrder - b._loadedOrder);
        })
        .map(({ _loadedOrder, ...uni }) => uni);
      setUniversities(ordered);
      setTasks(tsk);
      setEssays(ess);
    } catch (e) {
      console.error(e);
      toast.error('Could not load your universities', { description: e.message });
    } finally {
      setLoading(false);
    }
  };

  const usCount = universities.filter((u) => u.country === 'US').length;
  const ukCount = universities.filter((u) => u.country === 'UK').length;

  // Auto-suggest the platform and UK round from the name as it is typed.
  const onNameChange = (name) => {
    const patch = { name };
    if (form.country === 'UK') {
      const note = findUKUniversityNote(name);
      if (note) {
        if (note.rounds?.length === 1) patch.application_type = note.rounds[0];
        if (note.deadline) patch.deadline = note.deadline;
      }
      patch.application_platform = 'ucas';
    } else {
      const platform = getUniversityPlatform({ name, country: form.country, application_platform: form.application_platform });
      // Only override a choice the user has not deliberately made.
      if (form.application_platform === 'common_app' || !form.application_platform) {
        patch.application_platform = platform;
      }
    }
    setForm((prev) => ({ ...prev, ...patch }));
  };

  const handleCountryChange = (country) => {
    setForm((prev) => ({
      ...prev,
      country,
      application_type: '',
      application_platform: country === 'UK' ? 'ucas' : 'common_app',
      deadline: country === 'UK' ? (prev.deadline || '2027-01-13') : prev.deadline,
    }));
  };

  const handleAdd = async () => {
    if (!form.name || !form.country) return;
    const limit = LIST_LIMITS[form.country] || 40;
    const count = form.country === 'UK' ? ukCount : usCount;
    if (count >= limit) {
      toast.error(`List limit reached (${limit} ${form.country})`, {
        description: 'Remove one before adding another.',
      });
      return;
    }
    // "Stanford" and "Stanford University" are one school; a second entry would
    // split its tasks, essays and research between two rows.
    const existing = universities.find((u) => universityNamesMatch(u.name, form.name));
    if (existing) {
      toast.error(`${existing.name} is already on your list`, {
        description: 'Open it from the list instead of adding it twice.',
      });
      return;
    }
    setAdding(true);
    let createdUniversity = null;
    try {
      const uni = await base44.entities.University.create({
        name: form.name.trim(),
        country: form.country,
        major: form.major,
        application_type: form.application_type,
        deadline: form.deadline || null,
        notes: form.notes,
        application_platform: form.country === 'UK' ? 'ucas' : form.application_platform,
        sort_order: universities.reduce((max, uni) => Math.max(max, Number(uni.sort_order) || 0), -1) + 1,
      });
      if (!uni) {
        await loadData();
        throw new Error('Atlas could not confirm whether this university was added. Check the list before retrying to avoid a duplicate.');
      }
      createdUniversity = uni;

      const template = roadmapTemplates[form.country] || roadmapTemplates.US;
      await base44.entities.RoadmapTask.bulkCreate(
        template.map((t, i) => ({
          university_id: uni.id,
          title: t.title,
          description: t.description,
          category: t.category,
          completed: false,
          order: i + 1,
        })),
      );

      await loadData();
      setForm({
        name: '', country: form.country, major: '', application_type: '',
        deadline: form.country === 'UK' ? '2027-01-13' : '', notes: '',
        application_platform: form.country === 'UK' ? 'ucas' : 'common_app',
      });
      setDialogOpen(false);
      toast.success(`${uni.name} added`, {
        description: `${template.length} roadmap tasks created. Research it in University Research next.`,
      });
    } catch (e) {
      console.error(e);
      if (createdUniversity) {
        await loadData();
        toast.warning(`${createdUniversity.name} was added, but roadmap setup did not finish`, {
          description: `The university is on your list. Check its roadmap before retrying. ${e.message}`,
        });
      } else {
        toast.error('Could not add or confirm this university', { description: e.message });
      }
    } finally {
      setAdding(false);
    }
  };

  const handleRemove = async (uni) => {
    // Exactly the rows `Essay.deleteMany({ university_id })` is about to remove.
    const doomed = essays.filter((e) => e.university_id === uni.id);
    const written = doomed.filter((e) => (e.content || '').trim()).length;
    if (!window.confirm(
      `Remove ${uni.name}?\n\nThis also deletes its roadmap tasks and ${doomed.length} school-specific essay${doomed.length === 1 ? '' : 's'}`
      + (written ? ` — ${written} of them ${written === 1 ? 'has' : 'have'} writing in them, and that text goes with them.` : '.')
      + '\n\nSaved research and essays shared across the whole platform are kept.',
    )) return;
    try {
      await base44.entities.RoadmapTask.deleteMany({ university_id: uni.id });
      await base44.entities.Essay.deleteMany({ university_id: uni.id });
      await base44.entities.University.delete(uni.id);
      // Cached reviews, snapshots, and history for the deleted essays would
      // otherwise outlive them in this browser.
      clearEssayArtifacts(doomed.map((e) => e.id));
      await loadData();
      toast.success(`${uni.name} removed`);
    } catch (e) {
      toast.error('Could not remove this university', { description: e.message });
    }
  };

  const moveUniversity = async (fromIndex, offset) => {
    const toIndex = fromIndex + offset;
    if (reordering || toIndex < 0 || toIndex >= universities.length) return;
    const next = [...universities];
    const [moved] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, moved);
    const ordered = next.map((uni, index) => ({ ...uni, sort_order: index }));
    setUniversities(ordered);
    const savedIds = ordered.map((uni) => uni.id);
    setStored(UNIVERSITY_ORDER_KEY, savedIds);
    setReordering(true);
    try {
      const missingColumns = base44.capabilities?.missingOptionalColumns?.() || [];
      if (!missingColumns.includes('sort_order')) {
        const updates = await Promise.all(ordered.map((uni) =>
          base44.entities.University.update(uni.id, { sort_order: uni.sort_order }),
        ));
        if (updates.some((row) => !row)) throw new Error('One or more university records could not be updated.');
      }
      const missingAfterSave = base44.capabilities?.missingOptionalColumns?.() || [];
      if (missingAfterSave.includes('sort_order')) {
        toast.message('Order saved in this browser', {
          description: 'Run supabase/schema.sql to sync your card order across devices.',
        });
      } else {
        removeStored(UNIVERSITY_ORDER_KEY);
        toast.success('University order saved');
      }
    } catch (error) {
      toast.warning('Order kept in this browser', {
        description: `The database could not sync the new order. It will remain on this device. ${error.message}`,
      });
    } finally {
      setReordering(false);
    }
  };

  const getProgress = (uniId) => {
    const uniTasks = tasks.filter((t) => t.university_id === uniId);
    if (uniTasks.length === 0) return 0;
    return Math.round((uniTasks.filter((t) => t.completed).length / uniTasks.length) * 100);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32">
        <div className="w-8 h-8 border-2 border-border border-t-foreground rounded-full animate-spin" />
      </div>
    );
  }

  const ukNote = form.country === 'UK' ? findUKUniversityNote(form.name) : null;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-semibold tracking-tight">Universities</h1>
          <p className="text-foreground/50 mt-1.5">
            {usCount}/{LIST_LIMITS.US} US · {ukCount}/{LIST_LIMITS.UK} UK
          </p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="w-4 h-4 mr-2" />
              Add University
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle className="font-display">Add University</DialogTitle>
              <DialogDescription className="text-xs text-foreground/50">
                The application platform decides which of your essays get shared with this school.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-2">
              <div>
                <label className="block text-sm font-medium mb-1.5">University Name</label>
                <div className="relative">
                  <Search className="w-4 h-4 text-foreground/25 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    value={form.name}
                    onChange={(e) => onNameChange(e.target.value)}
                    placeholder="e.g. Stanford University"
                    className="w-full rounded-lg border border-input bg-background pl-9 pr-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-ring transition"
                  />
                </div>
                {ukNote && (
                  <p className="text-[11px] text-accent mt-1.5 leading-relaxed">{ukNote.note}</p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium mb-1.5">Country</label>
                <Select value={form.country} onValueChange={handleCountryChange}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="US">United States</SelectItem>
                    <SelectItem value="UK">United Kingdom</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {form.country === 'US' ? (
                <>
                  <div>
                    <label className="block text-sm font-medium mb-1.5">Application platform</label>
                    <Select
                      value={form.application_platform}
                      onValueChange={(v) => setForm({ ...form, application_platform: v })}
                    >
                      <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {PLATFORM_VALUES.filter((p) => p !== 'ucas').map((p) => (
                          <SelectItem key={p} value={p}>{PLATFORMS[p].label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-[11px] text-foreground/40 mt-1 leading-relaxed">
                      {PLATFORMS[form.application_platform]?.sharedNote}
                    </p>
                    {(form.application_platform === 'direct') && (
                      <p className="text-[11px] text-amber-700 mt-1">
                        UC campuses and MIT do not use the Common App — pick “University’s own application” for those.
                      </p>
                    )}
                  </div>

                  <div>
                    <label className="block text-sm font-medium mb-1.5">Application round</label>
                    <Select
                      value={form.application_type || 'none'}
                      onValueChange={(v) => setForm({ ...form, application_type: v === 'none' ? '' : v })}
                    >
                      <SelectTrigger className="w-full"><SelectValue placeholder="Not set" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Not set yet</SelectItem>
                        {US_ROUNDS.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <label className="block text-sm font-medium mb-1.5">UCAS deadline</label>
                    <Select
                      value={form.application_type || 'none'}
                      onValueChange={(v) => {
                        const round = UK_ROUNDS.find((r) => r.value === v);
                        setForm({
                          ...form,
                          application_type: v === 'none' ? '' : v,
                          deadline: round ? round.deadline : form.deadline,
                        });
                      }}
                    >
                      <SelectTrigger className="w-full"><SelectValue placeholder="Not set" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Not set yet</SelectItem>
                        {UK_ROUNDS.map((r) => (
                          <SelectItem key={r.value} value={r.value}>{r.value}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-[11px] text-foreground/40 mt-1 leading-relaxed">
                      Oxbridge, medicine, dentistry and veterinary close on 15 October 2026. Everything else
                      closes on 13 January 2027.
                    </p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1.5">Programme / course</label>
                    <input
                      value={form.major}
                      onChange={(e) => setForm({ ...form, major: e.target.value })}
                      placeholder="e.g. Natural Sciences (course code optional)"
                      className="w-full rounded-lg border border-input bg-background px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-ring transition"
                    />
                    <p className="text-[11px] text-foreground/40 mt-1">
                      One UCAS statement is sent to every course you choose, so keep your five choices in a
                      related field.
                    </p>
                  </div>
                </>
              )}

              {form.country === 'US' && (
                <div>
                  <label className="block text-sm font-medium mb-1.5">Major / programme</label>
                  <input
                    value={form.major}
                    onChange={(e) => setForm({ ...form, major: e.target.value })}
                    placeholder="e.g. Aeronautics and Astronautics"
                    className="w-full rounded-lg border border-input bg-background px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-ring transition"
                  />
                </div>
              )}

              <div>
                <label className="block text-sm font-medium mb-1.5">Deadline</label>
                <input
                  type="date"
                  value={form.deadline || ''}
                  onChange={(e) => setForm({ ...form, deadline: e.target.value })}
                  className="w-full rounded-lg border border-input bg-background px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-ring transition"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1.5">Notes</label>
                <textarea
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  placeholder="Anything you want to remember about this university…"
                  rows={2}
                  className="w-full rounded-lg border border-input bg-background px-3.5 py-2.5 text-sm resize-y focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-ring transition"
                />
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
              <Button onClick={handleAdd} disabled={adding || !form.name.trim()}>
                {adding ? 'Adding…' : 'Add University'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {universities.length === 0 ? (
        <div className="bg-card border border-border rounded-xl p-16 text-center">
          <GraduationCap className="w-10 h-10 text-foreground/20 mx-auto mb-4" />
          <h3 className="font-display text-lg font-medium mb-1">No universities yet</h3>
          <p className="text-sm text-foreground/40 mb-5 max-w-md mx-auto">
            Add your first university to get its roadmap, its shared writing requirements, and a research report.
          </p>
          <Button onClick={() => setDialogOpen(true)}>
            <Plus className="w-4 h-4 mr-2" />
            Add University
          </Button>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {universities.map((uni, cardIndex) => {
            const progress = getProgress(uni.id);
            const platform = getUniversityPlatform(uni);
            const hasShared = essays.some((e) => e.scope === 'common' && (e.application_platform || 'common_app') === platform);
            const daysLeft = daysUntil(uni.deadline);
            return (
              <div key={uni.id} className="group bg-card border border-border rounded-xl p-5 hover:border-foreground/20 transition-all relative">
                <div className="absolute top-3 right-3 flex items-center gap-0.5 opacity-70 group-hover:opacity-100 transition">
                  <button
                    type="button"
                    onClick={() => moveUniversity(cardIndex, -1)}
                    disabled={reordering || cardIndex === 0}
                    aria-label={`Move ${uni.name} up`}
                    title="Move university up"
                    className="p-1.5 rounded-md text-foreground/35 hover:text-foreground hover:bg-muted disabled:opacity-25 disabled:cursor-not-allowed"
                  >
                    <ArrowUp className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => moveUniversity(cardIndex, 1)}
                    disabled={reordering || cardIndex === universities.length - 1}
                    aria-label={`Move ${uni.name} down`}
                    title="Move university down"
                    className="p-1.5 rounded-md text-foreground/35 hover:text-foreground hover:bg-muted disabled:opacity-25 disabled:cursor-not-allowed"
                  >
                    <ArrowDown className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleRemove(uni)}
                    aria-label={`Remove ${uni.name}`}
                    title="Remove university"
                    className="p-1.5 rounded-md text-foreground/20 hover:text-destructive hover:bg-destructive/5"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
                <Link to={`/universities/${uni.id}`} className="block">
                  <div className="flex items-center gap-2 mb-3 flex-wrap pr-6">
                    <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${statusColors[uni.status] || statusColors.researching}`}>
                      {(uni.status || 'researching').replace('_', ' ')}
                    </span>
                    <Badge variant="outline" className="h-5 px-1.5 text-[10px] gap-1">
                      <Globe className="w-2.5 h-2.5" />{PLATFORMS[platform]?.short}
                    </Badge>
                    {!hasShared && PLATFORMS[platform]?.sharedEssays && (
                      <span title="You have not created the shared writing for this platform yet">
                        <Info className="w-3.5 h-3.5 text-amber-500" />
                      </span>
                    )}
                  </div>
                  <h3 className="font-display text-lg font-semibold pr-6 leading-tight mb-1">{uni.name}</h3>
                  {uni.major && <p className="text-sm text-foreground/50 mb-3 line-clamp-2">{uni.major}</p>}
                  {uni.application_type && (
                    <div className="flex items-center gap-1.5 text-xs text-foreground/40 mb-1">
                      <Globe className="w-3 h-3" />{uni.application_type}
                    </div>
                  )}
                  {uni.deadline && (
                    <div className="flex items-center gap-1.5 text-xs text-foreground/40 mb-3">
                      <Calendar className="w-3 h-3" />
                      {startOfLocalDay(uni.deadline)?.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                      {progress < 100 && daysLeft !== null && daysLeft >= 0 && (
                        <span className={daysLeft < 30 ? 'text-destructive' : 'text-foreground/30'}>· {daysLeft}d left</span>
                      )}
                    </div>
                  )}
                  <div className="mt-4">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-xs text-foreground/40">Roadmap</span>
                      <span className="text-xs font-medium">{progress}%</span>
                    </div>
                    <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                      <div className="h-full bg-accent rounded-full transition-all" style={{ width: `${progress}%` }} />
                    </div>
                  </div>
                  <div className="flex items-center gap-1 text-xs text-foreground/30 mt-4 group-hover:text-foreground/60 transition">
                    Open workspace
                    <ArrowRight className="w-3 h-3 group-hover:translate-x-0.5 transition" />
                  </div>
                </Link>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
