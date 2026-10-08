import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { toast } from 'sonner';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import {
  Sparkles, FileText, Plus, Save, Wand2, ClipboardCheck, Loader2, PenLine,
  Trash2, ChevronDown, ChevronUp, Library, CheckCircle2, CircleDashed,
  Info, ArrowRight, AlertTriangle,
} from 'lucide-react';
import EssayReviewPanel from '@/components/essay/EssayReviewPanel';
import UcasStatementEditor from '@/components/essay/UcasStatementEditor';
import PromptChooser from '@/components/essay/PromptChooser';
import { runAI } from '@/lib/ai';
import { buildProfileContext } from '@/lib/profileContext';
import {
  buildGeneratePrompt, GENERATE_SCHEMA, buildReviewPrompt, REVIEW_SCHEMA, buildPolishPrompt,
} from '@/lib/essayPrompts';
import {
  essaysApplicableToUniversity, getUniversityPlatform, PLATFORMS, PLATFORM_REQUIREMENTS,
  buildSharedEssayPlan, isSharedEssay, limitUnitFor, measureEssay, formatLimit, resolvedEssayLimit,
  ESSAY_TYPES, ESSAY_STATUSES, COMMON_APP_PROMPTS, UC_PIQS, UC_RULES, UCAS_RULES, UCAS_QUESTIONS,
  findKnowledgeRecord, isUcasQuestion, isLegacyUcasStatement, ucasCharacterBudget,
  isCommonAppPersonalStatement, chosenCommonAppPrompt, isAmbiguousCommonAppPrompt,
} from '@/lib/essayScope';
import { formatMaterialsForAI } from '@/lib/materialRole';
import { missingSchoolPrompts, promptsForUniversity, toEssayDraft } from '@/lib/supplementPrompts';
import {
  getLastUniversityId, setLastUniversityId,
  getLastEssayId, setLastEssayId,
  getCachedEssayReview, setCachedEssayReview,
  getCachedEssayGen, setCachedEssayGen,
} from '@/lib/persist';

const statusLabel = (s) => (ESSAY_STATUSES.find((x) => x.value === s) || { label: s }).label;

export default function EssayBuilder() {
  const [searchParams] = useSearchParams();
  const [universities, setUniversities] = useState([]);
  const [essays, setEssays] = useState([]);
  const [selectedUni, setSelectedUni] = useState(null);
  const [selectedEssay, setSelectedEssay] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [reviewResult, setReviewResult] = useState(null);
  const [reviewCachedAt, setReviewCachedAt] = useState(null);
  const [genAnalysis, setGenAnalysis] = useState(null);
  const [genGaps, setGenGaps] = useState([]);
  const [genCachedAt, setGenCachedAt] = useState(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [metaExpanded, setMetaExpanded] = useState(true);
  const [newEssay, setNewEssay] = useState({ title: '', type: 'supplemental', prompt: '', word_limit: 650, scope: 'university_specific', limit_unit: 'words' });
  const autosaveRef = useRef(null);

  const platform = useMemo(() => getUniversityPlatform(selectedUni), [selectedUni]);
  const platformInfo = PLATFORMS[platform];

  const loadEssays = useCallback(async () => {
    const ess = await base44.entities.Essay.list();
    setEssays(ess);
    return ess;
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const unis = await base44.entities.University.list();
        setUniversities(unis);
        const uniParam = searchParams.get('university');
        const lastUniId = getLastUniversityId();
        const initial =
          (uniParam && unis.find((u) => u.id === uniParam)) ||
          (lastUniId && unis.find((u) => u.id === lastUniId)) ||
          unis[0] ||
          null;
        setSelectedUni(initial);
        if (initial) setLastUniversityId(initial.id);
        if (!unis.length) setLoading(false);
      } catch (e) {
        console.error(e);
        toast.error('Could not load your universities', { description: e.message });
        setLoading(false);
      }
    })();
  }, [searchParams]);

  useEffect(() => {
    if (!selectedUni) return;
    (async () => {
      try {
        const ess = await loadEssays();
        const essayParam = searchParams.get('essay');
        const lastEssayId = getLastEssayId();
        let essayToSelect = null;
        if (essayParam) {
          essayToSelect = ess.find((e) => e.id === essayParam) || null;
        }
        if (!essayToSelect && lastEssayId) {
          // Only restore last essay if it belongs to this university/platform
          const candidate = ess.find((e) => e.id === lastEssayId);
          if (candidate) {
            const applicableToCurrent = essaysApplicableToUniversity([candidate], selectedUni).length > 0;
            if (applicableToCurrent) essayToSelect = candidate;
          }
        }
        if (essayToSelect) {
          setSelectedEssay(essayToSelect);
          setLastEssayId(essayToSelect.id);
          // Restore cached review/gen if any — keeps results when navigating
          const cachedReview = getCachedEssayReview(essayToSelect.id);
          if (cachedReview?.result) {
            setReviewResult(cachedReview.result);
            setReviewCachedAt(cachedReview.savedAt || null);
          } else {
            setReviewResult(null);
            setReviewCachedAt(null);
          }
          const cachedGen = getCachedEssayGen(essayToSelect.id);
          if (cachedGen) {
            setGenAnalysis(cachedGen.analysis || null);
            setGenGaps(cachedGen.gaps || []);
            setGenCachedAt(cachedGen.savedAt || null);
          } else {
            setGenAnalysis(null);
            setGenGaps([]);
            setGenCachedAt(null);
          }
        }
      } catch (e) {
        console.error(e);
        toast.error('Could not load your essays', { description: e.message });
      } finally {
        setLoading(false);
      }
    })();
  }, [selectedUni, searchParams, loadEssays]);

  // Warn before losing an unsaved draft.
  useEffect(() => {
    if (!dirty) return undefined;
    const handler = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  const applicable = useMemo(
    () => (selectedUni ? essaysApplicableToUniversity(essays, selectedUni) : essays),
    [essays, selectedUni],
  );
  const sharedEssays = applicable.filter(isSharedEssay);
  const specificEssays = applicable.filter((e) => !isSharedEssay(e));

  const pickEssay = (essay) => {
    const stayingInUcas = isUcasQuestion(essay) && isUcasQuestion(selectedEssay);
    if (dirty && !stayingInUcas && !window.confirm('You have unsaved changes on the current essay. Discard them?')) return;
    setSelectedEssay(essay);
    setLastEssayId(essay.id);
    // Restore cached results for this essay if we have them
    const cachedReview = getCachedEssayReview(essay.id);
    const cachedGen = getCachedEssayGen(essay.id);
    if (cachedReview?.result) {
      setReviewResult(cachedReview.result);
      setReviewCachedAt(cachedReview.savedAt || null);
    } else {
      setReviewResult(null);
      setReviewCachedAt(null);
    }
    if (cachedGen) {
      setGenAnalysis(cachedGen.analysis || null);
      setGenGaps(cachedGen.gaps || []);
      setGenCachedAt(cachedGen.savedAt || null);
    } else {
      setGenAnalysis(null);
      setGenGaps([]);
      setGenCachedAt(null);
    }
    if (!stayingInUcas) setDirty(false);
  };

  const handleSelectUni = (uniId) => {
    if (dirty && !window.confirm('You have unsaved changes. Discard them?')) return;
    const uni = universities.find((u) => u.id === uniId);
    setSelectedUni(uni);
    if (uni) setLastUniversityId(uni.id);
    setSelectedEssay(null);
    setReviewResult(null);
    setReviewCachedAt(null);
    setGenAnalysis(null);
    setGenGaps([]);
    setGenCachedAt(null);
    setDirty(false);
  };

  // --- persistence --------------------------------------------------------
  const persist = async (fields) => {
    if (!selectedEssay) return null;
    const updated = await base44.entities.Essay.update(selectedEssay.id, fields);
    setEssays((prev) => prev.map((e) => (e.id === updated.id ? { ...e, ...updated } : e)));
    setSelectedEssay((prev) => (prev ? { ...prev, ...fields } : prev));
    setDirty(false);
    return updated;
  };

  const handleFieldChange = (field, value) => {
    setSelectedEssay((prev) => ({ ...prev, [field]: value }));
    setDirty(true);
  };

  const onUcasChange = (essay, content) => {
    setEssays((prev) => prev.map((item) => (item.id === essay.id ? { ...item, content } : item)));
    setSelectedEssay((prev) => (prev?.id === essay.id ? { ...prev, content } : prev));
    setDirty(true);
  };

  const onUcasFocus = (essay) => {
    if (!essay || selectedEssay?.id === essay.id) return;
    setSelectedEssay(essay);
    setReviewResult(null);
    setGenAnalysis(null);
    setGenGaps([]);
  };

  const handleSave = async () => {
    if (!selectedEssay) return;
    setSaving(true);
    try {
      if (isUcasQuestion(selectedEssay)) {
        const rows = essays
          .filter(isUcasQuestion)
          .map((essay) => (essay.id === selectedEssay.id ? { ...essay, ...selectedEssay } : essay));
        for (const essay of rows) {
          await base44.entities.Essay.update(essay.id, {
            content: essay.content,
            prompt: essay.prompt,
            title: essay.title,
            word_limit: resolvedEssayLimit(essay),
            status: essay.status,
            type: essay.type,
            limit_unit: 'characters',
          });
        }
        setDirty(false);
      } else {
        await persist({
          title: selectedEssay.title,
          prompt: selectedEssay.prompt,
          word_limit: selectedEssay.word_limit,
          content: selectedEssay.content,
          type: selectedEssay.type,
          status: selectedEssay.status,
          limit_unit: limitUnitFor(selectedEssay),
        });
      }
      toast.success('Essay saved');
    } catch (e) {
      toast.error('Could not save this essay', { description: e.message });
    } finally {
      setSaving(false);
    }
  };

  // Debounced autosave so nothing is ever lost to a stray click.
  useEffect(() => {
    if (!dirty || !selectedEssay) return undefined;
    clearTimeout(autosaveRef.current);
    autosaveRef.current = setTimeout(async () => {
      try {
        if (isUcasQuestion(selectedEssay)) {
          const rows = essays
            .filter(isUcasQuestion)
            .map((essay) => (essay.id === selectedEssay.id ? { ...essay, ...selectedEssay } : essay));
          for (const essay of rows) {
            await base44.entities.Essay.update(essay.id, {
              content: essay.content,
              prompt: essay.prompt,
              title: essay.title,
              word_limit: resolvedEssayLimit(essay),
              status: essay.status,
              type: essay.type,
              limit_unit: 'characters',
            });
          }
          setDirty(false);
        } else {
          await persist({
            content: selectedEssay.content,
            prompt: selectedEssay.prompt,
            title: selectedEssay.title,
            word_limit: selectedEssay.word_limit,
            status: selectedEssay.status,
            type: selectedEssay.type,
            limit_unit: limitUnitFor(selectedEssay),
          });
        }
      } catch { /* autosave failures must not interrupt typing */ }
    }, 2500);
    return () => clearTimeout(autosaveRef.current);
  }, [dirty, essays, selectedEssay, selectedEssay?.id, selectedEssay?.content, selectedEssay?.prompt, selectedEssay?.title, selectedEssay?.word_limit, selectedEssay?.status, selectedEssay?.type]);

  // --- context ------------------------------------------------------------
  const gatherContext = async () => {
    const [profiles, materials] = await Promise.all([
      base44.entities.Profile.list(),
      base44.entities.Material.list(),
    ]);
    const profileText = buildProfileContext(profiles[0] || {}, { includeLeadershipBrief: true });
    // Platform-aware materials formatting so US/UK samples are distinguished
    const materialsText = formatMaterialsForAI(materials, { platform });
    const knowledgeRows = await base44.entities.CollegeKnowledge.list();
    const knowledge = findKnowledgeRecord(knowledgeRows, selectedUni?.name || '');
    const knowledgeText = knowledge?.knowledge
      || 'No research cached for this university yet. Research it in the Knowledge Base for a far more specific essay — this draft will rely on general knowledge only.';
    return { profileText, materialsText, knowledgeText };
  };

  // --- actions ------------------------------------------------------------
  const handleGenerate = async () => {
    if (!selectedEssay) return;
    if (isCommonAppPersonalStatement(selectedEssay) && !chosenCommonAppPrompt(selectedEssay)) {
      toast.error('Choose one Common App prompt first', {
        description: 'The personal statement answers one of the seven prompts. Leaving all of them in the box makes the draft try to answer every prompt.',
      });
      return;
    }
    if (isAmbiguousCommonAppPrompt(selectedEssay.prompt)) {
      toast.error('This essay has more than one official prompt in it', {
        description: 'Choose the single prompt you are answering before generating a draft.',
      });
      return;
    }
    setBusy('generate');
    setReviewResult(null);
    setGenAnalysis(null);
    try {
      const { profileText, materialsText, knowledgeText } = await gatherContext();
      const { ok, result } = await runAI({
        prompt: buildGeneratePrompt({
          essay: selectedEssay, university: selectedUni, platform,
          profileText, knowledgeText, materialsText, allEssays: essays,
        }),
        response_json_schema: GENERATE_SCHEMA,
      }, { fallbackTitle: 'Could not generate a draft' });

      if (!ok) return;
      const text = typeof result === 'string' ? result : result.essay;
      if (!text || !String(text).trim()) {
        toast.error('The AI returned an empty draft', { description: 'Try again, or lower the length you asked for.' });
        return;
      }
      const analysis = result.essay_analysis || '';
      const gaps = Array.isArray(result.gaps_for_applicant) ? result.gaps_for_applicant : [];
      setGenAnalysis(analysis);
      setGenGaps(gaps);
      const now = new Date().toISOString();
      setGenCachedAt(now);
      // Persist generation analysis so it survives navigation
      setCachedEssayGen(selectedEssay.id, { analysis, gaps });
      await persist({ content: String(text).trim(), status: 'drafting' });
      toast.success('Draft written', {
        description: gaps.length
          ? 'Check the "fill these in" list — the AI deliberately left gaps rather than inventing your life.'
          : 'Read it, then edit it in your own voice.',
      });
    } catch (e) {
      console.error(e);
    } finally {
      setBusy(null);
    }
  };

  const handleReview = async () => {
    if (!selectedEssay?.content) return;
    setBusy('review');
    setReviewResult(null);
    try {
      const { profileText, materialsText, knowledgeText } = await gatherContext();
      const { ok, result } = await runAI({
        prompt: buildReviewPrompt({
          essay: selectedEssay, university: selectedUni, platform,
          knowledgeText, reviewNotes: selectedEssay.review_notes, allEssays: essays,
          materialsText, profileText,
        }),
        response_json_schema: REVIEW_SCHEMA,
      }, { fallbackTitle: 'The review could not be completed' });

      if (!ok) return;
      setReviewResult(result);
      setReviewCachedAt(new Date().toISOString());
      setCachedEssayReview(selectedEssay.id, result);
      await persist({ status: 'in_review', review_notes: JSON.stringify(result, null, 2) });
      toast.success(`Reviewed: ${result.overall_score}/10`, {
        description: `${(result.weaknesses || []).length} weakness(es) and ${(result.priority_improvements || []).length} priority fix(es) found.`,
      });
    } catch (e) {
      console.error(e);
    } finally {
      setBusy(null);
    }
  };

  const handlePolish = async () => {
    if (!selectedEssay?.content) return;
    setBusy('polish');
    try {
      const { profileText, materialsText, knowledgeText } = await gatherContext();
      const { ok, result } = await runAI({
        prompt: buildPolishPrompt({
          essay: selectedEssay, university: selectedUni, platform,
          reviewResult, knowledgeText, allEssays: essays,
          materialsText, profileText,
        }),
      }, { fallbackTitle: 'Could not polish this essay' });

      if (!ok) return;
      const text = typeof result === 'string' ? result : result.essay;
      if (!text || !String(text).trim()) {
        toast.error('The AI returned an empty revision', { description: 'Your draft was left untouched.' });
        return;
      }
      await persist({ content: String(text).trim(), status: 'polishing' });
      toast.success('Revision applied', { description: 'Read the diff carefully — the editor will have cut aggressively.' });
    } catch (e) {
      console.error(e);
    } finally {
      setBusy(null);
    }
  };

  const handleDeleteEssay = async (essay) => {
    if (!window.confirm(`Delete "${essay.title}"? This cannot be undone.`)) return;
    try {
      await base44.entities.Essay.delete(essay.id);
      setEssays((prev) => prev.filter((e) => e.id !== essay.id));
      if (selectedEssay?.id === essay.id) {
        setSelectedEssay(null);
        setReviewResult(null);
        setGenAnalysis(null);
      }
      toast.success('Essay deleted');
    } catch (e) {
      toast.error('Could not delete this essay', { description: e.message });
    }
  };

  // --- creation -----------------------------------------------------------
  const createEssays = async (drafts, label) => {
    const created = [];
    for (const d of drafts) {
      const row = await base44.entities.Essay.create({
        title: d.title,
        type: d.type || 'supplemental',
        prompt: d.prompt || '',
        word_limit: resolvedEssayLimit(d),
        content: '',
        status: 'not_started',
        scope: d.scope || 'university_specific',
        application_platform: d.application_platform || platform,
        limit_unit: d.limit_unit || 'words',
        ...(d.scope === 'university_specific' && selectedUni
          ? { university_id: selectedUni.id, university_name: selectedUni.name }
          : {}),
      });
      created.push(row);
    }
    await loadEssays();
    if (created[0]) setSelectedEssay(created[0]);
    toast.success(`${created.length} essay${created.length > 1 ? 's' : ''} created`, { description: label });
    return created;
  };

  const handleCreateEssay = async () => {
    if (!newEssay.title) return;
    if (newEssay.scope === 'university_specific' && !selectedUni) return;
    const wordLimit = Number(newEssay.word_limit);
    if (!Number.isFinite(wordLimit) || wordLimit <= 0) {
      toast.error('Set a word or character limit for this essay.');
      return;
    }
    try {
      await createEssays([{
        ...newEssay,
        word_limit: wordLimit,
        application_platform: newEssay.scope === 'common' ? (selectedUni ? platform : 'common_app') : platform,
        limit_unit: newEssay.limit_unit || (platform === 'ucas' ? 'characters' : 'words'),
      }], newEssay.scope === 'common'
        ? `Shared with every ${platformInfo?.short || ''} university on your list.`
        : 'Written only for this university.');
      setDialogOpen(false);
      setNewEssay({ title: '', type: 'supplemental', prompt: '', word_limit: 650, scope: 'university_specific', limit_unit: 'words' });
    } catch (e) {
      console.error(e);
      toast.error('Could not create that essay', { description: e.message });
    }
  };

  const missingShared = useMemo(
    () => (selectedUni ? buildSharedEssayPlan(platform, essays) : []),
    [platform, essays, selectedUni],
  );
  const missingSchool = useMemo(
    () => (selectedUni ? missingSchoolPrompts(selectedUni.name, essays) : []),
    [selectedUni, essays],
  );
  const ucasBudget = useMemo(() => ucasCharacterBudget(essays), [essays]);

  const addMissingShared = async () => {
    try {
      await createEssays(missingShared, `These apply to every ${platformInfo?.short || ''} university — write them once.`);
    } catch (e) {
      toast.error('Could not add the shared essays', { description: e.message });
    }
  };

  // --- render -------------------------------------------------------------
  if (loading) {
    return (
      <div className="flex items-center justify-center py-32">
        <div className="w-8 h-8 border-2 border-border border-t-foreground rounded-full animate-spin" />
      </div>
    );
  }

  if (universities.length === 0) {
    return (
      <div className="text-center py-32">
        <p className="text-foreground/50 mb-4">Add a university first to start building essays.</p>
        <Link to="/universities"><Button>Go to Universities</Button></Link>
      </div>
    );
  }

  const unit = selectedEssay ? limitUnitFor(selectedEssay) : 'words';
  const currentCount = selectedEssay ? measureEssay(selectedEssay.content || '', unit) : 0;
  const limit = selectedEssay ? Number(selectedEssay.word_limit) || 0 : 0;
  const overBy = currentCount - limit;
  const unitLabel = formatLimit(unit);

  const renderEssayItem = (essay) => {
    const u = limitUnitFor(essay);
    const n = measureEssay(essay.content || '', u);
    const lim = Number(essay.word_limit) || 0;
    return (
      <div key={essay.id} className="group relative">
        <button
          onClick={() => pickEssay(essay)}
          className={`w-full text-left p-3 rounded-xl border transition-all pr-8 ${
            selectedEssay?.id === essay.id
              ? 'border-foreground/20 bg-card shadow-sm'
              : 'border-border bg-card/50 hover:bg-card hover:border-foreground/10'
          }`}
        >
          <div className="flex items-center gap-2 mb-1">
            {essay.status === 'final' || essay.status === 'polishing'
              ? <CheckCircle2 className="w-3.5 h-3.5 text-green-500 shrink-0" />
              : <CircleDashed className="w-3.5 h-3.5 text-foreground/25 shrink-0" />}
            <span className="text-sm font-medium truncate">{essay.title}</span>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-foreground/40">
            <span>{statusLabel(essay.status)}</span>
            <span>·</span>
            <span className={(isUcasQuestion(essay) ? ucasBudget.over : n > lim) ? 'text-destructive' : ''}>
              {isUcasQuestion(essay)
                ? `${n} chars`
                : `${n}/${lim || '—'} ${u === 'characters' ? 'chars' : 'w'}`}
            </span>
          </div>
        </button>
        <button
          onClick={() => handleDeleteEssay(essay)}
          className="absolute top-2.5 right-2 p-1 rounded text-foreground/20 hover:text-destructive opacity-0 group-hover:opacity-100 transition"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    );
  };

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="max-w-2xl">
          <h1 className="font-display text-3xl font-semibold tracking-tight">Essay Builder</h1>
          <p className="text-foreground/50 mt-1.5">
            Shared writing is written once and sent to every school on the platform. School-specific writing is
            written for one school. Atlas keeps them apart so you never write the same essay twice.
            <span className="block text-xs text-foreground/40 mt-1">Your last university and essay are remembered, so you return to where you left off — not always Stanford.</span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={selectedUni?.id} onValueChange={handleSelectUni}>
            <SelectTrigger className="w-64"><SelectValue placeholder="Select university..." /></SelectTrigger>
            <SelectContent>
              {universities.map((u) => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* How this school actually works */}
      {platformInfo && (
        <div className="bg-card border border-border rounded-xl p-4">
          <div className="flex items-start gap-3 flex-wrap">
            <Badge variant="outline" className="shrink-0">{platformInfo.label}</Badge>
            <p className="text-sm text-foreground/60 flex-1 min-w-[240px]">
              {PLATFORM_REQUIREMENTS[platform]?.summary}
            </p>
            {selectedUni && (
              <Badge variant="secondary" className="text-[11px] gap-1">
                <CheckCircle2 className="w-3 h-3" />
                Last session: {selectedUni.name}
              </Badge>
            )}
          </div>
          <p className="text-xs text-foreground/45 mt-2 flex items-start gap-1.5">
            <Info className="w-3.5 h-3.5 mt-px shrink-0" />
            {platformInfo.sharedNote}
          </p>
        </div>
      )}

      {missingShared.length > 0 && (
        <div className="flex items-start gap-3 p-4 rounded-xl bg-accent/5 border border-accent/20">
          <Library className="w-5 h-5 text-accent shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm font-medium">
              {missingShared.length} shared {missingShared.length > 1 ? 'essays are' : 'essay is'} missing
            </p>
            <p className="text-xs text-foreground/50 mt-0.5">
              {platformInfo?.sharedNote} Create {missingShared.length > 1 ? 'them' : 'it'} once and every{' '}
              {platformInfo?.short} university picks {missingShared.length > 1 ? 'them' : 'it'} up automatically.
            </p>
            <Button size="sm" className="mt-2.5" onClick={addMissingShared}>
              <Plus className="w-3.5 h-3.5 mr-1.5" />
              Add shared {missingShared.length > 1 ? 'essays' : 'essay'}
            </Button>
          </div>
        </div>
      )}

      {missingSchool.length > 0 && (
        <div className="flex items-start gap-3 p-4 rounded-xl bg-card border border-border">
          <FileText className="w-5 h-5 text-foreground/40 shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm font-medium">
              {missingSchool.length} published {missingSchool.length > 1 ? 'prompts' : 'prompt'} for {selectedUni.name}
            </p>
            <p className="text-xs text-foreground/50 mt-0.5">
              These are the 2026-27 questions from the university’s own page. Add them instead of typing the prompts.
              Confirm the wording on the official page before you submit.
            </p>
            <Button
              size="sm"
              variant="outline"
              className="mt-2.5"
              onClick={async () => {
                try {
                  await createEssays(
                    missingSchool.map((item) => toEssayDraft(item, { applicationPlatform: platform })),
                    'Taken from the university’s published prompts.',
                  );
                } catch (e) {
                  toast.error('Could not add those prompts', { description: e.message });
                }
              }}
            >
              <Plus className="w-3.5 h-3.5 mr-1.5" />
              Add these prompts
            </Button>
          </div>
        </div>
      )}

      <div className="grid lg:grid-cols-[240px_1fr] gap-5">
        {/* Essay list */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-medium text-sm text-foreground/60">Essays</h2>
            <Button size="sm" variant="outline" onClick={() => setDialogOpen(true)}>
              <Plus className="w-3.5 h-3.5 mr-1" /> New
            </Button>
          </div>

          {applicable.length === 0 ? (
            <p className="text-xs text-foreground/40 px-1 py-4 text-center">
              No essays yet. Add the shared writing above, or click “New”.
            </p>
          ) : (
            <div className="space-y-4">
              {sharedEssays.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-xs font-medium text-accent/80 px-1 flex items-center gap-1.5">
                    <Library className="w-3 h-3" />
                    Shared with every {platformInfo?.short} university
                  </p>
                  {sharedEssays.map(renderEssayItem)}
                </div>
              )}
              {specificEssays.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-xs font-medium text-foreground/40 px-1">{selectedUni?.name}</p>
                  {specificEssays.map(renderEssayItem)}
                </div>
              )}
            </div>
          )}

          {selectedUni && (
            <Link
              to="/universities"
              className="block text-xs text-foreground/35 hover:text-foreground/60 transition pt-1"
            >
              Add another university <ArrowRight className="w-3 h-3 inline" />
            </Link>
          )}
        </div>

        {/* Editor */}
        <div className="min-w-0">
          {!selectedEssay ? (
            <div className="bg-card border border-border rounded-xl p-16 text-center">
              <PenLine className="w-10 h-10 text-foreground/15 mx-auto mb-4" />
              <h3 className="font-display text-lg font-medium mb-1">Select or create an essay</h3>
              <p className="text-sm text-foreground/40 max-w-md mx-auto">
                Start with the shared writing — it is sent to every {platformInfo?.short} university, so you only
                write it once.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="bg-card border border-border rounded-xl overflow-hidden">
                <button
                  onClick={() => setMetaExpanded(!metaExpanded)}
                  className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-muted/30 transition"
                >
                  <span className="font-medium text-sm flex items-center gap-2 min-w-0">
                    <FileText className="w-4 h-4 text-foreground/40 shrink-0" />
                    <span className="truncate">{selectedEssay.title || 'Untitled Essay'}</span>
                    {isSharedEssay(selectedEssay) && (
                      <Badge variant="outline" className="h-5 px-1.5 text-[10px] text-accent border-accent/40 shrink-0">
                        shared
                      </Badge>
                    )}
                  </span>
                  {metaExpanded ? <ChevronUp className="w-4 h-4 text-foreground/40 shrink-0" /> : <ChevronDown className="w-4 h-4 text-foreground/40 shrink-0" />}
                </button>

                {metaExpanded && (
                  <div className="px-5 pb-5 space-y-3 border-t border-border pt-4">
                    <input
                      value={selectedEssay.title || ''}
                      onChange={(e) => handleFieldChange('title', e.target.value)}
                      placeholder="Essay title"
                      className="w-full font-display text-base font-semibold bg-transparent border-none focus:outline-none -mt-1"
                    />
                    <div className="grid sm:grid-cols-3 gap-3">
                      <div>
                        <label className="block text-xs font-medium text-foreground/50 mb-1">Type</label>
                        <Select value={selectedEssay.type || 'supplemental'} onValueChange={(v) => handleFieldChange('type', v)}>
                          <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {ESSAY_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-foreground/50 mb-1">Status</label>
                        <Select value={selectedEssay.status || 'not_started'} onValueChange={(v) => handleFieldChange('status', v)}>
                          <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {ESSAY_STATUSES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-foreground/50 mb-1">Limit ({unitLabel})</label>
                        <Input
                          type="number"
                          value={selectedEssay.word_limit ?? ''}
                          onChange={(e) => handleFieldChange('word_limit', e.target.value === '' ? null : Number(e.target.value))}
                        />
                      </div>
                    </div>
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="block text-xs font-medium text-foreground/50">Prompt</label>
                        <button
                          onClick={() => setLibraryOpen(true)}
                          className="text-[11px] text-accent hover:underline"
                        >
                          Browse this cycle&apos;s prompts
                        </button>
                      </div>
                      {isUcasQuestion(selectedEssay) ? (
                        <p className="text-sm text-foreground/70 leading-relaxed rounded-lg border border-border bg-muted/20 p-3">
                          {selectedEssay.prompt}
                          <span className="block text-[11px] text-foreground/40 mt-1">
                            This wording is fixed. The three answers share 4,000 characters.
                          </span>
                        </p>
                      ) : (
                        <PromptChooser
                          platform={selectedEssay.scope === 'common' ? (selectedEssay.application_platform || platform) : platform}
                          universityName={selectedEssay.scope === 'common' ? '' : selectedUni?.name}
                          scope={selectedEssay.scope || 'university_specific'}
                          value={selectedEssay.prompt || ''}
                          onChange={(prompt) => handleFieldChange('prompt', prompt)}
                          onPick={(choice) => {
                            handleFieldChange('prompt', choice.prompt);
                            if (choice.word_limit) handleFieldChange('word_limit', choice.word_limit);
                            if (choice.limit_unit) handleFieldChange('limit_unit', choice.limit_unit);
                            if (choice.type) handleFieldChange('type', choice.type);
                          }}
                        />
                      )}
                    </div>
                  </div>
                )}
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                <Button onClick={handleGenerate} disabled={busy !== null}>
                  {busy === 'generate' ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Wand2 className="w-4 h-4 mr-2" />}
                  {busy === 'generate' ? 'Writing…' : 'Generate draft'}
                </Button>
                <Button onClick={handleReview} disabled={busy !== null || !selectedEssay.content} variant="outline">
                  {busy === 'review' ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <ClipboardCheck className="w-4 h-4 mr-2" />}
                  {busy === 'review' ? 'Reviewing…' : 'Admissions review'}
                </Button>
                <Button onClick={handlePolish} disabled={busy !== null || !selectedEssay.content} variant="outline">
                  {busy === 'polish' ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Sparkles className="w-4 h-4 mr-2" />}
                  {busy === 'polish' ? 'Editing…' : 'Apply edits'}
                </Button>
                <div className="flex items-center gap-2 ml-auto">
                  {dirty && <span className="text-[11px] text-foreground/35">Unsaved — autosaving…</span>}
                  <Button onClick={handleSave} disabled={saving || !dirty} variant="ghost" size="sm">
                    <Save className="w-4 h-4 mr-1.5" />
                    {saving ? 'Saving…' : 'Save'}
                  </Button>
                  <Button onClick={() => handleDeleteEssay(selectedEssay)} disabled={busy !== null} variant="ghost" size="sm" className="text-destructive hover:text-destructive">
                    <Trash2 className="w-4 h-4 mr-1.5" /> Delete
                  </Button>
                </div>
              </div>

              {genAnalysis && (
                <div className="bg-accent/5 border border-accent/20 rounded-xl p-4">
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <div className="flex items-center gap-2">
                      <Sparkles className="w-4 h-4 text-accent" />
                      <span className="text-sm font-medium">Why this essay, in this slot</span>
                    </div>
                    {genCachedAt && (
                      <span className="text-[11px] text-foreground/35">cached {new Date(genCachedAt).toLocaleDateString()} — stays when you navigate</span>
                    )}
                  </div>
                  <p className="text-sm text-foreground/60 leading-relaxed">{genAnalysis}</p>
                  {genGaps.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-accent/20">
                      <p className="text-xs font-medium text-foreground/60 mb-1.5">
                        Fill these in yourself — the AI left them blank rather than inventing your life:
                      </p>
                      <ul className="space-y-1">
                        {genGaps.map((g, i) => (
                          <li key={i} className="text-xs text-foreground/55 flex gap-2">
                            <span className="text-accent">→</span>{g}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}

              {isLegacyUcasStatement(selectedEssay) && (
                <div className="flex items-start gap-2 p-3 rounded-xl bg-amber-50 border border-amber-200">
                  <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
                  <p className="text-xs text-amber-800 leading-relaxed">
                    This is the old single UCAS box. The real form is three answers that share 4,000 characters.
                    Add the three shared answers, move each response into its own box, then delete this one.
                  </p>
                </div>
              )}

              {isUcasQuestion(selectedEssay) ? (
                <div className="bg-card border border-border rounded-xl p-5">
                  <UcasStatementEditor
                    essays={essays}
                    focusId={selectedEssay.id}
                    onChange={onUcasChange}
                    onFocus={onUcasFocus}
                  />
                </div>
              ) : (
              <div className="bg-card border border-border rounded-xl p-5">
                <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
                  <span className="text-sm font-medium text-foreground/50">Draft</span>
                  <span className={`text-xs font-medium ${overBy > 0 ? 'text-destructive' : 'text-foreground/40'}`}>
                    {currentCount.toLocaleString()} / {limit ? limit.toLocaleString() : '—'} {unitLabel}
                    {overBy > 0 && ` · ${overBy.toLocaleString()} over`}
                    {unit === 'characters' && limit > 0 && (
                      <span className="text-foreground/30"> · min {UCAS_RULES.perAnswerMinChars} per answer</span>
                    )}
                  </span>
                </div>
                {overBy > 0 && (
                  <div className="flex items-start gap-2 mb-3 p-2.5 rounded-lg bg-red-50 border border-red-200">
                    <AlertTriangle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                    <p className="text-xs text-red-700">
                      This is over the limit. {unit === 'characters'
                        ? 'UCAS rejects anything past the character cap, and it counts everything you type — including spaces.'
                        : 'Admissions portals will not accept an over-length essay.'}
                    </p>
                  </div>
                )}
                <textarea
                  value={selectedEssay.content || ''}
                  onChange={(e) => handleFieldChange('content', e.target.value)}
                  placeholder="Write here, or let the AI draft from your profile, materials, and university research…"
                  rows={26}
                  className="w-full rounded-lg border border-input bg-background px-4 py-3 text-sm leading-relaxed resize-y focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-ring transition placeholder:text-foreground/25 font-body"
                />
              </div>
              )}

              <EssayReviewPanel reviewResult={reviewResult} cachedAt={reviewCachedAt} onPolish={handlePolish} polishing={busy === 'polish'} />
            </div>
          )}
        </div>
      </div>

      {/* New Essay Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-display">New Essay</DialogTitle>
            <DialogDescription className="text-xs text-foreground/50">
              The scope decides who sees this. This is the single most important choice on this screen.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <label className="block text-xs font-medium text-foreground/50 mb-1.5">Title</label>
              <Input
                value={newEssay.title}
                onChange={(e) => setNewEssay({ ...newEssay, title: e.target.value })}
                placeholder="e.g. Stanford Roommate Essay"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-foreground/50 mb-1.5">Who is this written for?</label>
              <Select value={newEssay.scope} onValueChange={(v) => setNewEssay({ ...newEssay, scope: v })}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="university_specific">
                    Only {selectedUni?.name || 'this university'}
                  </SelectItem>
                  <SelectItem value="common">
                    Every {platformInfo?.short} university (shared)
                  </SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-foreground/40 mt-1.5 leading-relaxed">
                {newEssay.scope === 'common'
                  ? platformInfo?.sharedNote
                  : `School-specific. ${PLATFORM_REQUIREMENTS[platform]?.reviewFocus || ''}`}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-foreground/50 mb-1.5">Type</label>
                <Select value={newEssay.type} onValueChange={(v) => setNewEssay({ ...newEssay, type: v })}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ESSAY_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="block text-xs font-medium text-foreground/50 mb-1.5">Counted in</label>
                <Select
                  value={newEssay.limit_unit}
                  onValueChange={(v) => setNewEssay({
                    ...newEssay,
                    limit_unit: v,
                    word_limit: v === 'characters' ? 4000 : 650,
                  })}
                >
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="words">Words</SelectItem>
                    <SelectItem value="characters">Characters (UCAS)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-xs font-medium text-foreground/50">Prompt</label>
                <button
                  onClick={() => { setDialogOpen(false); setLibraryOpen(true); }}
                  className="text-[11px] text-accent hover:underline"
                >
                  Browse this cycle&apos;s prompts
                </button>
              </div>
              <PromptChooser
                platform={platform}
                universityName={newEssay.scope === 'common' ? '' : selectedUni?.name}
                scope={newEssay.scope}
                value={newEssay.prompt}
                onChange={(prompt) => setNewEssay({ ...newEssay, prompt })}
                onPick={(choice) => setNewEssay((prev) => ({
                  ...prev,
                  prompt: choice.prompt,
                  title: prev.title || choice.title || '',
                  word_limit: choice.word_limit || prev.word_limit,
                  limit_unit: choice.limit_unit || prev.limit_unit,
                  type: choice.type || prev.type,
                }))}
              />
            </div>

            <div className="flex items-center gap-2">
              <Input
                type="number"
                value={newEssay.word_limit ?? ''}
                onChange={(e) => setNewEssay({
                  ...newEssay,
                  word_limit: e.target.value === '' ? null : Number(e.target.value),
                })}
                className="w-32"
              />
              <span className="text-xs text-foreground/40">
                {newEssay.limit_unit === 'characters' ? 'characters (including spaces)' : 'words'}
              </span>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button
              onClick={handleCreateEssay}
              disabled={!newEssay.title || (newEssay.scope === 'university_specific' && !selectedUni)}
            >
              Create Essay
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <PromptLibraryDialog
        open={libraryOpen}
        onOpenChange={setLibraryOpen}
        platform={platform}
        universityName={selectedUni?.name}
        onApply={(draft) => {
          if (selectedEssay) {
            handleFieldChange('prompt', draft.prompt);
            handleFieldChange('title', draft.title || selectedEssay.title);
            handleFieldChange('word_limit', Number(draft.word_limit) || selectedEssay.word_limit);
            handleFieldChange('limit_unit', draft.limit_unit || limitUnitFor(selectedEssay));
            toast.success('Prompt applied');
          } else {
            setNewEssay((prev) => ({
              ...prev,
              title: draft.title,
              prompt: draft.prompt,
              word_limit: Number(draft.word_limit) || prev.word_limit,
              limit_unit: draft.limit_unit || prev.limit_unit,
              type: draft.type || prev.type,
            }));
            setDialogOpen(true);
          }
        }}
      />
    </div>
  );
}
// ---------------------------------------------------------------------------
// The researched prompt library — the real 2026-27 requirements, in-app.
// ---------------------------------------------------------------------------
function PromptLibraryDialog({ open, onOpenChange, platform, universityName, onApply }) {
  const groups = useMemo(() => {
    const out = [];
    if (platform === 'common_app') {
      out.push({
        key: 'ca-personal',
        title: 'Common App Personal Statement',
        note: 'One essay, 250-650 words, sent identically to every Common App school on your list. Choose one prompt.',
        items: COMMON_APP_PROMPTS.map((p) => ({
          key: p.key,
          label: `Prompt ${p.number} — ${p.label}`,
          meta: `${p.share}% of applicants chose this last cycle`,
          prompt: p.text,
          role: p.role,
          warn: p.watchOut,
          word_limit: 650,
          limit_unit: 'words',
          type: 'personal_statement',
        })),
      });
      out.push({
        key: 'ca-other',
        title: 'Common App — other writing',
        note: 'Only needed if you have something to add. Most applicants need neither of these.',
        items: [
          { key: 'ca-additional', label: 'Additional Information (300 words)', meta: 'Optional', prompt: 'Use this space for anything else that is important: a gap year, a change of name, a health or family circumstance, or a project you want to explain. Shared with every Common App school.', role: 'Context, not storytelling. It is read after the personal statement, so it only matters if it changes how the rest of the file is read.', word_limit: 300, limit_unit: 'words', type: 'other' },
          { key: 'ca-challenges', label: 'Challenges and Circumstances (250 words)', meta: 'Optional — leave empty unless you have an exceptional circumstance', prompt: 'If there has been a significant personal, academic, or work challenge that has affected your work or activities, you may discuss it here. Shared with every Common App school.', role: 'Reserved for genuine exceptional circumstances. Using it without a real reason reads as an appeal for sympathy.', word_limit: 250, limit_unit: 'words', type: 'other' },
        ],
      });
    }
    if (platform === 'uc') {
      out.push({
        key: 'uc',
        title: `UC Personal Insight Questions (answer ${UC_RULES.pick} of ${UC_RULES.of})`,
        note: UC_RULES.note,
        items: UC_PIQS.map((q) => ({
          key: q.key,
          label: `PIQ ${q.number} — ${q.theme}`,
          meta: `${q.limit} words`,
          prompt: q.prompt,
          role: q.role,
          word_limit: q.limit,
          limit_unit: 'words',
          type: 'supplemental',
        })),
      });
    }
    if (platform === 'ucas') {
      out.push({
        key: 'ucas',
        title: `UCAS Personal Statement — three answers, ${UCAS_RULES.totalChars.toLocaleString()} characters shared`,
        note: `${UCAS_RULES.note} Use “Add shared essays” to create the three boxes. Do not paste all three prompts into one essay.`,
        items: UCAS_QUESTIONS.map((q) => ({
          key: q.key,
          label: `Question ${q.number} — ${q.label}`,
          meta: `Minimum ${q.minChars} characters · ${q.suggestedShare}`,
          prompt: q.prompt,
          role: q.role,
          word_limit: UCAS_RULES.totalChars,
          limit_unit: 'characters',
          type: 'personal_statement',
          title: `UCAS Q${q.number} — ${q.label}`,
        })),
      });
    }
    const schoolItems = promptsForUniversity(universityName).map((item) => ({
      key: item.id,
      label: item.title,
      meta: `${item.word_limit} ${item.limit_unit === 'characters' ? 'characters' : 'words'} · ${item.cycle}`,
      prompt: item.prompt,
      role: item.role,
      word_limit: item.word_limit,
      limit_unit: item.limit_unit,
      type: item.type,
      title: item.title,
      source: item.source,
    }));
    if (schoolItems.length) {
      out.push({
        key: 'school',
        title: `Published prompts for ${universityName}`,
        note: 'Checked against the university’s own page for 2026-27. Confirm before you submit — Atlas does not invent prompts for schools that are not listed.',
        items: schoolItems,
      });
    }
    if (platform === 'coalition') {
      out.push({
        key: 'coalition',
        title: 'Coalition Application',
        note: PLATFORMS.coalition.sharedNote,
        items: [{
          key: 'coalition-personal',
          label: 'Coalition Personal Essay',
          meta: '500-650 words',
          prompt: 'Write the Coalition Application personal essay. One essay is sent to every Coalition member school on your list, so keep it free of school-specific references.',
          role: PLATFORMS.coalition.sharedNote,
          word_limit: 650,
          limit_unit: 'words',
          type: 'personal_statement',
        }],
      });
    }
    if (platform === 'direct' || platform === 'other') {
      out.push({
        key: 'direct',
        title: 'School-specific writing',
        note: 'Nothing is shared on this platform, so every prompt comes from the university itself. Research the school in the Knowledge Base and paste the exact prompts.',
        items: [{
          key: 'direct-why',
          label: 'Typical “Why this school?” shape',
          meta: 'Varies by school',
          prompt: 'Paste the exact prompt from the university\'s own application portal here. Schools that run their own portal usually ask shorter, more specific questions than a supplement would — often with hard word caps.',
          role: PLATFORM_REQUIREMENTS[platform]?.reviewFocus,
          word_limit: 650,
          limit_unit: 'words',
          type: 'why_this_school',
        }],
      });
    }
    return out;
  }, [platform]);

  const [expanded, setExpanded] = useState(null);

  useEffect(() => { setExpanded(null); }, [platform]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display">Prompt library — {PLATFORMS[platform]?.label}</DialogTitle>
          <DialogDescription className="text-xs text-foreground/50">
            The real requirements for the {PLATFORMS[platform]?.short} 2026-27 cycle (Fall 2027 entry), with what
            each prompt is actually testing. Pick one to paste it into your essay.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-2">
          {groups.map((group) => (
            <div key={group.key}>
              <h3 className="font-display text-base font-semibold mb-1">{group.title}</h3>
              <p className="text-xs text-foreground/45 mb-2.5 leading-relaxed">{group.note}</p>
              <div className="space-y-2">
                {group.items.map((item) => (
                  <div key={item.key} className="border border-border rounded-lg overflow-hidden">
                    <button
                      onClick={() => setExpanded(expanded === item.key ? null : item.key)}
                      className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-muted/40 transition"
                    >
                      <span className="min-w-0">
                        <span className="block text-sm font-medium">{item.label}</span>
                        <span className="block text-[11px] text-foreground/40">{item.meta}</span>
                      </span>
                      <ChevronDown className={`w-4 h-4 text-foreground/40 shrink-0 transition-transform ${expanded === item.key ? 'rotate-180' : ''}`} />
                    </button>
                    {expanded === item.key && (
                      <div className="px-4 pb-4 space-y-2.5 border-t border-border pt-3">
                        <p className="text-sm text-foreground/70 leading-relaxed italic">“{item.prompt}”</p>
                        {item.role && (
                          <p className="text-xs text-foreground/50 leading-relaxed">
                            <span className="font-medium">What it is testing: </span>{item.role}
                          </p>
                        )}
                        {item.warn && (
                          <p className="text-xs text-amber-700 leading-relaxed flex items-start gap-1.5">
                            <AlertTriangle className="w-3.5 h-3.5 mt-px shrink-0" />{item.warn}
                          </p>
                        )}
                        <Button size="sm" onClick={() => onApply({ ...item, title: item.label })}>
                          Use this prompt
                        </Button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
