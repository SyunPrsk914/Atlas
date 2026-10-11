import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { toast } from 'sonner';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import {
  Sparkles, FileText, Plus, Save, Wand2, ClipboardCheck, Loader2, PenLine,
  Trash2, ChevronDown, ChevronUp, Library, CheckCircle2, CircleDashed,
  Info, ArrowRight, AlertTriangle, Undo2, FileDiff, RotateCcw, Ruler,
} from 'lucide-react';
import EssayReviewPanel from '@/components/essay/EssayReviewPanel';
import EssayDiffView from '@/components/essay/EssayDiffView';
import LengthMeter from '@/components/essay/LengthMeter';
import RevisionProgress from '@/components/essay/RevisionProgress';
import UcasStatementEditor from '@/components/essay/UcasStatementEditor';
import PromptChooser from '@/components/essay/PromptChooser';
import { runAI } from '@/lib/ai';
import { buildProfileContext } from '@/lib/profileContext';
import {
  buildGeneratePrompt, GENERATE_SCHEMA, buildReviewPrompt, REVIEW_SCHEMA, buildPolishPrompt,
  POLISH_SCHEMA, LENGTH_REPAIR_SCHEMA, buildLengthRepairPrompt, AI_TEMPERATURES,
  extractRevisedEssay, cleanEssayText, withMeasuredLength,
} from '@/lib/essayPrompts';
import { assessLength, isBetterLength } from '@/lib/essayLength';
import { diffText, diffStats, isAggressiveRewrite } from '@/lib/textDiff';
import {
  essaysApplicableToUniversity, getUniversityPlatform, PLATFORMS, PLATFORM_REQUIREMENTS,
  buildSharedEssayPlan, isSharedEssay, limitUnitFor, measureEssay, formatLimit, resolvedEssayLimit,
  ESSAY_TYPES, ESSAY_STATUSES, COMMON_APP_PROMPTS, UC_PIQS, UC_RULES, UCAS_RULES, UCAS_QUESTIONS,
  findKnowledgeRecord, isUcasQuestion, isLegacyUcasStatement, ucasCharacterBudget,
  isCommonAppPersonalStatement, chosenCommonAppPrompt, isAmbiguousCommonAppPrompt,
} from '@/lib/essayScope';
import { formatMaterialsForAI } from '@/lib/materialRole';
import { hasLiveModel, isLiveOutcome } from '@/lib/aiOutcome';
import { loadApplicantKnowledgeText } from '@/lib/applicantKnowledgeService';
import { missingSchoolPrompts, promptsForUniversity, toEssayDraft } from '@/lib/supplementPrompts';
import {
  getLastUniversityId, setLastUniversityId,
  getLastEssayId, setLastEssayId,
  getCachedEssayReview, setCachedEssayReview, clearCachedEssayReview,
  getCachedEssayGen, setCachedEssayGen, clearCachedEssayGen,
  getEssaySnapshot, setEssaySnapshot, clearEssaySnapshot,
  getEssayProgress, pushEssayProgress, clearEssayProgress,
  getAutoReviewAfterEdit, setAutoReviewAfterEdit,
} from '@/lib/persist';

const statusLabel = (s) => (ESSAY_STATUSES.find((x) => x.value === s) || { label: s }).label;
const DRAFT_ANCHOR_KEY = 'atlas_draft_anchor_';

function localDraftAnchor(id) {
  if (!id || typeof window === 'undefined') return '';
  try {
    return window.localStorage.getItem(`${DRAFT_ANCHOR_KEY}${id}`) || '';
  } catch {
    return '';
  }
}

function rememberDraftAnchor(id, value) {
  if (!id || typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(`${DRAFT_ANCHOR_KEY}${id}`, String(value || ''));
  } catch { /* the database remains the source of truth when storage is blocked */ }
}

function hydrateEssay(essay) {
  if (!essay || Object.prototype.hasOwnProperty.call(essay, 'draft_anchor')) return essay;
  return { ...essay, draft_anchor: localDraftAnchor(essay.id) };
}

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
  const [previousScore, setPreviousScore] = useState(null);
  const [genAnalysis, setGenAnalysis] = useState(null);
  const [genGaps, setGenGaps] = useState([]);
  const [genCachedAt, setGenCachedAt] = useState(null);
  // The last AI change to the selected essay, so it can be undone this visit.
  const [undoStep, setUndoStep] = useState(null);
  // The last AI edit, kept so the applicant can see exactly which words changed
  // and put their own version back.
  const [revision, setRevision] = useState(null);
  const [snapshot, setSnapshot] = useState(null);
  const [progress, setProgress] = useState([]);
  // An AI answer that missed the length contract and could not be repaired.
  const [lengthIssue, setLengthIssue] = useState(null);
  const [autoReview, setAutoReview] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [metaExpanded, setMetaExpanded] = useState(true);
  const [missingEssayColumns, setMissingEssayColumns] = useState([]);
  const [newEssay, setNewEssay] = useState({ title: '', type: 'supplemental', prompt: '', draft_anchor: '', word_limit: 650, scope: 'university_specific', limit_unit: 'words' });
  const autosaveRef = useRef(null);

  useEffect(() => { setAutoReview(getAutoReviewAfterEdit()); }, []);

  const platform = useMemo(() => getUniversityPlatform(selectedUni), [selectedUni]);
  const platformInfo = PLATFORMS[platform];

  const loadEssays = useCallback(async () => {
    const ess = (await base44.entities.Essay.list()).map(hydrateEssay);
    setEssays(ess);
    return ess;
  }, []);

  /**
   * Per-essay state that lives in this browser: the version before the last AI
   * edit, and the record of what each AI action did to the length and the score.
   */
  const loadEssayLocalState = (essay) => {
    setRevision(null);
    setLengthIssue(null);
    setPreviousScore(null);
    if (!essay) {
      setSnapshot(null);
      setProgress([]);
      return;
    }
    setSnapshot(getEssaySnapshot(essay.id));
    setProgress(getEssayProgress(essay.id));
  };

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const missing = typeof base44.capabilities?.probe === 'function'
          ? await base44.capabilities.probe()
          : (base44.capabilities?.missingOptionalColumns?.() || []);
        if (active) setMissingEssayColumns(missing.filter((column) => column === 'draft_anchor'));
      } catch { /* the normal save path still reports database errors */ }
    })();
    return () => { active = false; };
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
          loadEssayLocalState(essayToSelect);
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
    loadEssayLocalState(essay);
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
    loadEssayLocalState(null);
    setDirty(false);
  };

  // --- persistence --------------------------------------------------------
  const persist = async (fields) => {
    if (!selectedEssay) return null;
    if (Object.prototype.hasOwnProperty.call(fields, 'draft_anchor')) {
      rememberDraftAnchor(selectedEssay.id, fields.draft_anchor);
    }
    const updated = await base44.entities.Essay.update(selectedEssay.id, fields);
    setEssays((prev) => prev.map((e) => (e.id === updated.id ? { ...e, ...updated, ...fields } : e)));
    setSelectedEssay((prev) => (prev ? { ...prev, ...updated, ...fields } : prev));
    setDirty(false);
    return updated;
  };

  const handleFieldChange = (field, value) => {
    if (field === 'draft_anchor') rememberDraftAnchor(selectedEssay?.id, value);
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
    loadEssayLocalState(essay);
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
            draft_anchor: essay.draft_anchor || '',
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
          draft_anchor: selectedEssay.draft_anchor || '',
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
              draft_anchor: essay.draft_anchor || '',
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
            draft_anchor: selectedEssay.draft_anchor || '',
            word_limit: selectedEssay.word_limit,
            status: selectedEssay.status,
            type: selectedEssay.type,
            limit_unit: limitUnitFor(selectedEssay),
          });
        }
      } catch { /* autosave failures must not interrupt typing */ }
    }, 2500);
    return () => clearTimeout(autosaveRef.current);
  }, [dirty, essays, selectedEssay, selectedEssay?.id, selectedEssay?.content, selectedEssay?.prompt, selectedEssay?.title, selectedEssay?.draft_anchor, selectedEssay?.word_limit, selectedEssay?.status, selectedEssay?.type]);

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
      || 'No university research is cached for this university yet. Research it in University Research for a far more specific essay — this draft will rely on general knowledge only.';
    const applicantText = await loadApplicantKnowledgeText({ platform });
    return { profileText, materialsText, knowledgeText, applicantText };
  };

  // --- guards and undo ----------------------------------------------------
  /** Demo output is placeholder text: nothing is written, reviewed, or edited with it. */
  const guardLive = (action) => {
    if (hasLiveModel()) return true;
    toast.error(`${action} needs a connected AI model`, {
      description: 'Demo mode shows placeholder text, so Atlas will not write, review, or edit an essay with it. Nothing was changed. Connect a local model in AI setup (AI status in the sidebar).',
      duration: 9000,
    });
    return false;
  };

  /** Asks before text the applicant wrote is replaced by an AI result. */
  const confirmReplace = (essay, action) => {
    if (!essay?.content?.trim()) return true;
    return window.confirm(`The current text of “${essay.title}” will be replaced when ${action} finishes. You can undo that until you leave this page. Continue?`);
  };

  /** Keeps the fields an AI action is about to change, so they can be restored. */
  const rememberForUndo = (essay, fields, label) => {
    setUndoStep({ essayId: essay.id, fields, label });
  };

  const undoLastChange = async () => {
    if (!undoStep) return;
    const { essayId, fields, label } = undoStep;
    try {
      await base44.entities.Essay.update(essayId, fields);
      setEssays((prev) => prev.map((e) => (e.id === essayId ? { ...e, ...fields } : e)));
      if (selectedEssay?.id === essayId) {
        setSelectedEssay((prev) => (prev ? { ...prev, ...fields } : prev));
        if ('review_notes' in fields) {
          let previous = null;
          try {
            previous = fields.review_notes ? JSON.parse(fields.review_notes) : null;
          } catch { /* not a saved review */ }
          setReviewResult(previous);
        }
      }
      setUndoStep(null);
      toast.success('Restored', { description: `Undid: ${label}.` });
    } catch (e) {
      toast.error('Could not undo this change', { description: e.message });
    }
  };

  /** Why the drafting actions are unavailable right now, in one sentence. */
  const actionHintFor = (essay) => {
    if (!hasLiveModel()) return 'Demo mode: connect a local model in AI setup to generate, review, or edit.';
    if (!essay?.content?.trim()) return 'Review and Apply edits read the essay text. Write or generate the essay first.';
    return '';
  };

  // --- actions ------------------------------------------------------------
  /**
   * One targeted second pass when an AI answer misses the length contract.
   *
   * A model that returns 480 words for a 650-word prompt has not finished the
   * job, and a model whose answer was cut off by its own output limit has not
   * even started one. Atlas asks it to finish, and keeps the second answer only
   * if it is actually closer to the band — a worse repair is thrown away.
   */
  const repairLength = async ({ essay, context, text, assessment, mode, originalText = '', preservedRatio = null }) => {
    const outcome = await runAI({
      prompt: buildLengthRepairPrompt({
        essay, university: selectedUni, platform, mode, text, assessment,
        originalText, preservedRatio, allEssays: essays,
        knowledgeText: context.knowledgeText, materialsText: context.materialsText,
        profileText: context.profileText, applicantText: context.applicantText,
      }),
      response_json_schema: LENGTH_REPAIR_SCHEMA,
      temperature: AI_TEMPERATURES.repair,
    }, { fallbackTitle: 'The length fix could not be completed', quiet: true });

    if (!isLiveOutcome(outcome)) return null;
    const candidate = cleanEssayText(extractRevisedEssay(outcome.result));
    if (!candidate) return null;
    const candidateAssessment = assessLength(candidate, essay, essays);
    if (!isBetterLength(candidateAssessment, assessment)) return null;
    return {
      text: candidate,
      assessment: candidateAssessment,
      notes: typeof outcome.result?.notes === 'string' ? outcome.result.notes : '',
      gaps: Array.isArray(outcome.result?.gaps_for_applicant) ? outcome.result.gaps_for_applicant : [],
    };
  };

  /** Records one AI action against this essay and refreshes the visible history. */
  const recordProgress = (essayId, entry) => {
    const next = pushEssayProgress(essayId, entry);
    setProgress(next);
    return next;
  };

  const handleGenerate = async () => {
    if (!selectedEssay) return;
    if (!guardLive('Generate a draft')) return;
    if (!confirmReplace(selectedEssay, 'the draft is written')) return;
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
    const before = selectedEssay.content || '';
    setBusy('generate');
    setReviewResult(null);
    setGenAnalysis(null);
    setRevision(null);
    setLengthIssue(null);
    try {
      const context = await gatherContext();
      const outcome = await runAI({
        prompt: buildGeneratePrompt({
          essay: selectedEssay, university: selectedUni, platform,
          profileText: context.profileText, knowledgeText: context.knowledgeText,
          materialsText: context.materialsText, applicantText: context.applicantText,
          allEssays: essays,
        }),
        response_json_schema: GENERATE_SCHEMA,
        temperature: AI_TEMPERATURES.generate,
      }, { fallbackTitle: 'Could not generate a draft' });

      if (!isLiveOutcome(outcome)) return;
      const result = outcome.result && typeof outcome.result === 'object' ? outcome.result : {};
      let text = cleanEssayText(extractRevisedEssay(outcome.result));
      if (!text) {
        toast.error('The AI returned an empty draft', { description: 'Try again, or lower the length you asked for.' });
        return;
      }
      let assessment = assessLength(text, selectedEssay, essays);
      let repaired = false;
      let repairNotes = '';
      if (assessment.needsWork || outcome.meta?.truncated) {
        setBusy('repair');
        const fix = await repairLength({ essay: selectedEssay, context, text, assessment, mode: 'generate' });
        if (fix) {
          repairNotes = `The first answer came back at ${assessment.count.toLocaleString()} ${formatLimit(assessment.unit)}${outcome.meta?.truncated ? ' and was cut off by the model' : ''}; Atlas sent it back and the model returned ${fix.assessment.count.toLocaleString()}.`;
          text = fix.text;
          assessment = fix.assessment;
          repaired = true;
          if (fix.gaps.length) {
            result.gaps_for_applicant = [...(Array.isArray(result.gaps_for_applicant) ? result.gaps_for_applicant : []), ...fix.gaps];
          }
        }
      }

      const analysis = [result.essay_analysis || '', repairNotes].filter(Boolean).join('\n\n');
      const gaps = Array.isArray(result.gaps_for_applicant) ? result.gaps_for_applicant : [];
      setGenAnalysis(analysis);
      setGenGaps(gaps);
      setGenCachedAt(new Date().toISOString());
      // Persist generation analysis so it survives navigation
      setCachedEssayGen(selectedEssay.id, { analysis, gaps });

      if (before.trim()) {
        setEssaySnapshot(selectedEssay.id, { content: before, label: 'the text before this draft', review: reviewResult });
        setSnapshot(getEssaySnapshot(selectedEssay.id));
      }
      rememberForUndo(selectedEssay, { content: before, status: selectedEssay.status }, 'draft written');
      await persist({ content: text, status: 'drafting' });

      recordProgress(selectedEssay.id, {
        action: 'generate',
        unit: assessment.unit,
        wordsBefore: assessLength(before, selectedEssay, essays).count,
        wordsAfter: assessment.count,
        scoreBefore: reviewResult?.overall_score ?? null,
        scoreAfter: null,
        note: repaired ? 'length repaired automatically' : assessment.ok ? 'inside the target band' : 'still outside the target band',
      });
      setLengthIssue(assessment.ok ? null : assessment);

      if (!assessment.ok) {
        toast.warning(`Draft written, but it is ${assessment.shortfall ? `${assessment.shortfall.toLocaleString()} ${formatLimit(assessment.unit)} short` : `${assessment.overage.toLocaleString()} ${formatLimit(assessment.unit)} over`}`, {
          description: `${assessment.message} Use “Fix length” below — Atlas will ask the model to finish the job properly.`,
          duration: 12000,
        });
      } else {
        toast.success(`Draft written — ${assessment.count.toLocaleString()} ${formatLimit(assessment.unit)}`, {
          description: gaps.length
            ? 'Check the "fill these in" list — the AI deliberately left gaps rather than inventing your life.'
            : 'Inside the target band. Read it, then edit it in your own voice.',
        });
      }
    } catch (e) {
      console.error(e);
    } finally {
      setBusy(null);
    }
  };

  /**
   * Runs the admissions review and stores it. Takes the essay explicitly so the
   * automatic re-review after an edit can score the text that was just saved
   * rather than the copy still held in this render's state.
   */
  const runReview = async (essayRow, previousReview = null) => {
    const target = essayRow || selectedEssay;
    if (!target?.content?.trim()) return null;
    const context = await gatherContext();
    const rows = essays.map((row) => (row.id === target.id ? { ...row, content: target.content } : row));
    const outcome = await runAI({
      prompt: buildReviewPrompt({
        essay: target, university: selectedUni, platform,
        knowledgeText: context.knowledgeText, reviewNotes: target.review_notes,
        allEssays: rows, materialsText: context.materialsText,
        profileText: context.profileText, applicantText: context.applicantText,
        previousReview,
      }),
      response_json_schema: REVIEW_SCHEMA,
      temperature: AI_TEMPERATURES.review,
    }, { fallbackTitle: 'The review could not be completed' });

    if (!isLiveOutcome(outcome)) return null;
    // Atlas measures the length itself: a model's own word count disagrees with
    // the editor often enough that it cannot be shown to the applicant.
    const measured = withMeasuredLength(outcome.result, target, rows);
    setReviewResult(measured);
    setReviewCachedAt(new Date().toISOString());
    setCachedEssayReview(target.id, measured);
    return measured;
  };

  const handleReview = async () => {
    if (!selectedEssay?.content) return;
    if (!guardLive('The admissions review')) return;
    const prior = reviewResult;
    setBusy('review');
    setReviewResult(null);
    try {
      const measured = await runReview(selectedEssay, prior);
      if (!measured) {
        // A review that produced nothing must not leave the panel empty.
        if (prior) setReviewResult(prior);
        return;
      }
      setPreviousScore(prior?.overall_score ?? null);
      rememberForUndo(selectedEssay, { status: selectedEssay.status, review_notes: selectedEssay.review_notes || '' }, 'review saved');
      await persist({ status: 'in_review', review_notes: JSON.stringify(measured, null, 2) });
      recordProgress(selectedEssay.id, {
        action: 'review',
        unit: measured.unit,
        wordsBefore: measured.word_count,
        wordsAfter: measured.word_count,
        scoreBefore: prior?.overall_score ?? null,
        scoreAfter: measured.overall_score,
      });
      const delta = prior?.overall_score > 0 ? Math.round((measured.overall_score - prior.overall_score) * 10) / 10 : null;
      toast.success(`Reviewed: ${measured.overall_score}/10${delta === null ? '' : ` (${delta > 0 ? '+' : ''}${delta})`}`, {
        description: `${(measured.weaknesses || []).length} weakness(es) and ${(measured.priority_improvements || []).length} priority fix(es) found.`,
      });
    } catch (e) {
      console.error(e);
      // A failed re-review must not cost the applicant the review they had.
      if (prior) setReviewResult(prior);
    } finally {
      setBusy(null);
    }
  };

  const handlePolish = async () => {
    if (!selectedEssay?.content?.trim()) return;
    if (!guardLive('Apply edits')) return;
    if (!confirmReplace(selectedEssay, 'the edits are applied')) return;
    const before = selectedEssay.content || '';
    const priorReview = reviewResult;
    setBusy('polish');
    setLengthIssue(null);
    try {
      const context = await gatherContext();
      const outcome = await runAI({
        prompt: buildPolishPrompt({
          essay: selectedEssay, university: selectedUni, platform,
          reviewResult: priorReview, knowledgeText: context.knowledgeText, allEssays: essays,
          materialsText: context.materialsText, profileText: context.profileText,
          applicantText: context.applicantText,
        }),
        response_json_schema: POLISH_SCHEMA,
        temperature: AI_TEMPERATURES.polish,
      }, { fallbackTitle: 'Could not edit this essay' });

      if (!isLiveOutcome(outcome)) return;
      const result = outcome.result && typeof outcome.result === 'object' ? outcome.result : {};
      let text = cleanEssayText(extractRevisedEssay(outcome.result));
      if (!text) {
        toast.error('The AI returned an empty revision', { description: 'Your draft was left untouched.' });
        return;
      }
      let assessment = assessLength(text, selectedEssay, essays);
      let repaired = false;
      if (assessment.needsWork || outcome.meta?.truncated) {
        // An edit that shrinks the essay below its target band is the exact
        // failure this feature exists to prevent, so it is repaired before it
        // is ever shown as finished.
        setBusy('repair');
        const firstStats = diffStats(diffText(before, text).ops);
        const fix = await repairLength({
          essay: selectedEssay, context, text, assessment, mode: 'edit',
          originalText: before, preservedRatio: firstStats.preservedRatio,
        });
        if (fix) {
          text = fix.text;
          assessment = fix.assessment;
          repaired = true;
        }
      }

      const { ops } = diffText(before, text);
      const stats = diffStats(ops);
      const rewritten = isAggressiveRewrite(stats);

      setEssaySnapshot(selectedEssay.id, { content: before, label: 'your version before this edit', review: priorReview });
      setSnapshot(getEssaySnapshot(selectedEssay.id));
      rememberForUndo(selectedEssay, { content: before, status: selectedEssay.status }, 'edits applied');
      await persist({ content: text, status: 'polishing' });

      setRevision({
        before,
        after: text,
        ops,
        stats,
        unit: assessment.unit,
        changes: Array.isArray(result.changes) ? result.changes : [],
        why: result.why_it_scores_higher || '',
        summary: result.summary_of_edit || '',
        protectedItems: Array.isArray(result.protected) ? result.protected : [],
        gaps: Array.isArray(result.gaps_for_applicant) ? result.gaps_for_applicant : [],
        preservedEstimate: Number(result.preserved_estimate) > 0 ? Number(result.preserved_estimate) : null,
        at: new Date().toISOString(),
        repaired,
      });
      setLengthIssue(assessment.ok ? null : assessment);

      if (rewritten) {
        toast.warning('The editor rewrote most of your draft', {
          description: `Only ${Math.round(stats.preservedRatio * 100)}% of your words survived, and Atlas asked it to keep at least 80%. The comparison below highlights everything it touched — restore your version if you prefer it.`,
          duration: 14000,
        });
      } else {
        toast.success('Revision applied', {
          description: `${stats.kept} of your ${stats.oldTotal} ${formatLimit(assessment.unit)} kept, ${stats.added} added, ${stats.removed} cut. Every change is highlighted below.`,
        });
      }

      // The whole point of an edit is a better essay, so measure it on the same
      // rubric instead of leaving the applicant to guess.
      const updatedEssay = { ...selectedEssay, content: text, status: 'polishing' };
      let nextReview = null;
      if (autoReview && hasLiveModel()) {
        setBusy('re_review');
        try {
          nextReview = await runReview(updatedEssay, priorReview);
          if (nextReview) {
            setPreviousScore(priorReview?.overall_score ?? null);
            await persist({ status: 'in_review', review_notes: JSON.stringify(nextReview, null, 2) });
          } else if (priorReview) {
            setReviewResult(priorReview);
          }
        } catch (e) {
          // The edit itself succeeded and is already on screen; a failed
          // re-review is reported, not allowed to hide the diff.
          console.error(e);
          if (priorReview) setReviewResult(priorReview);
          toast.warning('The edit was applied, but the automatic re-score failed', {
            description: 'Use "Admissions review" to score it again.',
            duration: 10000,
          });
        }
      }

      recordProgress(selectedEssay.id, {
        action: 'edit',
        unit: assessment.unit,
        wordsBefore: assessLength(before, selectedEssay, essays).count,
        wordsAfter: assessment.count,
        scoreBefore: priorReview?.overall_score ?? null,
        scoreAfter: nextReview?.overall_score ?? null,
        preservedRatio: stats.preservedRatio,
        note: repaired ? 'length repaired automatically' : rewritten ? 'rewrote more than expected' : '',
      });

      if (nextReview) {
        const beforeScore = Number(priorReview?.overall_score) || 0;
        const afterScore = Number(nextReview.overall_score) || 0;
        const delta = beforeScore > 0 ? Math.round((afterScore - beforeScore) * 10) / 10 : null;
        if (delta !== null && delta < 0) {
          toast.warning(`The revision scored lower: ${beforeScore} → ${afterScore}/10`, {
            description: 'Restore your version below, or apply edits again — the new review says exactly what is wrong now.',
            duration: 14000,
          });
        } else if (delta !== null) {
          toast.success(`Re-scored after the edit: ${beforeScore} → ${afterScore}/10 (+${delta})`, {
            description: 'Same rubric, same scale, measured on the text now in the editor.',
          });
        } else {
          toast.success(`Re-scored after the edit: ${afterScore}/10`);
        }
      }
    } catch (e) {
      console.error(e);
    } finally {
      setBusy(null);
    }
  };

  /** Brings the current text to its length contract on demand. */
  const handleFixLength = async () => {
    if (!selectedEssay?.content?.trim()) return;
    if (!guardLive('The length fix')) return;
    const before = selectedEssay.content;
    const assessment = assessLength(before, selectedEssay, essays);
    if (assessment.ok) {
      toast.success('This draft is already inside its target band', { description: assessment.message });
      setLengthIssue(null);
      return;
    }
    setBusy('repair');
    try {
      const context = await gatherContext();
      const fix = await repairLength({ essay: selectedEssay, context, text: before, assessment, mode: 'fix' });
      if (!fix) {
        toast.error('The model could not bring this to length', {
          description: 'Its second answer was not closer to the target band, so Atlas changed nothing. Try again, or add the missing detail yourself.',
          duration: 10000,
        });
        return;
      }
      const { ops } = diffText(before, fix.text);
      const stats = diffStats(ops);
      setEssaySnapshot(selectedEssay.id, { content: before, label: 'before the length fix', review: reviewResult });
      setSnapshot(getEssaySnapshot(selectedEssay.id));
      rememberForUndo(selectedEssay, { content: before, status: selectedEssay.status }, 'length fixed');
      await persist({ content: fix.text, status: selectedEssay.status === 'not_started' ? 'drafting' : selectedEssay.status });
      setRevision({
        before, after: fix.text, ops, stats, unit: fix.assessment.unit,
        changes: [], why: fix.notes || '', gaps: fix.gaps || [], at: new Date().toISOString(),
      });
      setLengthIssue(fix.assessment.ok ? null : fix.assessment);
      recordProgress(selectedEssay.id, {
        action: 'repair',
        unit: fix.assessment.unit,
        wordsBefore: assessment.count,
        wordsAfter: fix.assessment.count,
        scoreBefore: reviewResult?.overall_score ?? null,
        scoreAfter: null,
        note: 'length fixed',
      });
      toast.success(`Now ${fix.assessment.count.toLocaleString()} ${formatLimit(fix.assessment.unit)}`, {
        description: fix.assessment.message,
      });
    } catch (e) {
      console.error(e);
    } finally {
      setBusy(null);
    }
  };

  /** Puts the applicant's own pre-edit text back, and the review that went with it. */
  const handleRestoreSnapshot = async () => {
    if (!selectedEssay || !snapshot?.content) return;
    if (!window.confirm('Put your own version back? The AI revision will be replaced in the editor.')) return;
    const replaced = selectedEssay.content || '';
    const restored = snapshot.content;
    setBusy('restore');
    try {
      rememberForUndo(selectedEssay, { content: replaced, status: selectedEssay.status }, 'AI revision re-applied');
      await persist({ content: restored, status: 'polishing' });
      const assessment = assessLength(restored, selectedEssay, essays);
      if (snapshot.review) {
        const measured = withMeasuredLength(snapshot.review, { ...selectedEssay, content: restored }, essays);
        setReviewResult(measured);
        setCachedEssayReview(selectedEssay.id, measured);
        setPreviousScore(null);
      }
      clearEssaySnapshot(selectedEssay.id);
      setSnapshot(null);
      setRevision(null);
      setLengthIssue(assessment.ok ? null : assessment);
      recordProgress(selectedEssay.id, {
        action: 'restore',
        unit: assessment.unit,
        wordsBefore: assessLength(replaced, selectedEssay, essays).count,
        wordsAfter: assessment.count,
        scoreBefore: reviewResult?.overall_score ?? null,
        scoreAfter: snapshot.review?.overall_score ?? null,
        note: 'your own version put back',
      });
      toast.success('Your version is back in the editor');
    } catch (e) {
      toast.error('Could not restore that version', { description: e.message });
    } finally {
      setBusy(null);
    }
  };

  /** Rebuilds the comparison from the stored snapshot, e.g. after a reload. */
  const showSnapshotDiff = () => {
    if (!selectedEssay || !snapshot?.content) return;
    const current = selectedEssay.content || '';
    const { ops } = diffText(snapshot.content, current);
    setRevision({
      before: snapshot.content,
      after: current,
      ops,
      stats: diffStats(ops),
      unit: limitUnitFor(selectedEssay),
      changes: [],
      at: snapshot.savedAt || null,
      fromSnapshot: true,
    });
  };

  const handleDeleteEssay = async (essay) => {
    if (!window.confirm(`Delete "${essay.title}"? This cannot be undone.`)) return;
    try {
      await base44.entities.Essay.delete(essay.id);
      setEssays((prev) => prev.filter((e) => e.id !== essay.id));
      // Nothing cached for a deleted essay should outlive it in this browser.
      clearEssaySnapshot(essay.id);
      clearEssayProgress(essay.id);
      clearCachedEssayReview(essay.id);
      clearCachedEssayGen(essay.id);
      if (selectedEssay?.id === essay.id) {
        setSelectedEssay(null);
        setReviewResult(null);
        setGenAnalysis(null);
        loadEssayLocalState(null);
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
        draft_anchor: d.draft_anchor || '',
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
      rememberDraftAnchor(row.id, d.draft_anchor || '');
      created.push(hydrateEssay(row));
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
      setNewEssay({ title: '', type: 'supplemental', prompt: '', draft_anchor: '', word_limit: 650, scope: 'university_specific', limit_unit: 'words' });
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
  // The draft judged against its length contract, not just against its ceiling.
  const lengthState = selectedEssay ? assessLength(selectedEssay.content || '', selectedEssay, essays) : null;
  const editing = busy === 'polish' || busy === 'repair' || busy === 're_review';

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

              <div className="bg-accent/5 border border-accent/20 rounded-xl p-4 space-y-2">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <label htmlFor="essay-root" className="text-sm font-medium text-foreground/70">What must this essay be rooted in?</label>
                  <span className="text-[11px] text-accent/80">Your direction is a hard constraint</span>
                </div>
                <Textarea
                  id="essay-root"
                  value={selectedEssay.draft_anchor || ''}
                  onChange={(e) => handleFieldChange('draft_anchor', e.target.value)}
                  placeholder="Add the moments, interests, questions, relationships, or qualities you want the draft to grow from."
                  rows={4}
                  className="bg-background/70"
                />
                <p className="text-[11px] text-foreground/45 leading-relaxed">
                  Atlas will use the profile, materials, guidance, and sample craft to deepen this direction. It must not replace your roots with a random activity; if something is missing, it will leave a gap for you.
                </p>
                {missingEssayColumns.includes('draft_anchor') && (
                  <p className="text-[11px] text-amber-700 leading-relaxed">
                    Your database is missing the root field. Atlas is keeping this direction in this browser for now; run <span className="font-mono">supabase/schema.sql</span> to persist it across devices.
                  </p>
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
                  {editing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Sparkles className="w-4 h-4 mr-2" />}
                  {busy === 'polish' ? 'Editing…'
                    : busy === 'repair' ? 'Finishing the length…'
                      : busy === 're_review' ? 'Re-scoring…'
                        : 'Apply edits'}
                </Button>
                {lengthState?.needsWork && (
                  <Button
                    onClick={handleFixLength}
                    disabled={busy !== null}
                    variant="outline"
                    className="border-amber-300 text-amber-800 hover:bg-amber-50 hover:text-amber-900"
                  >
                    {busy === 'repair' ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Ruler className="w-4 h-4 mr-2" />}
                    {lengthState.state === 'over' ? 'Trim to the limit' : 'Finish the length'}
                  </Button>
                )}
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

              <div className="flex items-center gap-4 flex-wrap text-xs">
                <label className="inline-flex items-center gap-2 cursor-pointer select-none">
                  <Switch
                    checked={autoReview}
                    onCheckedChange={(value) => { setAutoReview(value); setAutoReviewAfterEdit(value); }}
                    disabled={busy !== null}
                  />
                  <span className="text-foreground/55">Re-score automatically after an edit</span>
                </label>
                <span className="text-foreground/30 hidden sm:inline">
                  So you can see whether the edit actually raised the score.
                </span>
                {snapshot?.content && snapshot.content !== (selectedEssay.content || '') && !revision && (
                  <div className="flex items-center gap-3 ml-auto">
                    <button onClick={showSnapshotDiff} className="inline-flex items-center gap-1.5 text-accent hover:underline">
                      <FileDiff className="w-3.5 h-3.5" />
                      Compare with {snapshot.label || 'the previous version'}
                    </button>
                    <button onClick={handleRestoreSnapshot} disabled={busy !== null} className="inline-flex items-center gap-1.5 text-foreground/45 hover:text-foreground hover:underline">
                      <RotateCcw className="w-3.5 h-3.5" />
                      Restore it
                    </button>
                  </div>
                )}
              </div>
              {(undoStep?.essayId === selectedEssay.id || actionHintFor(selectedEssay)) && (
                <div className="flex items-center gap-3 flex-wrap text-xs">
                  {undoStep?.essayId === selectedEssay.id && (
                    <button onClick={undoLastChange} className="inline-flex items-center gap-1.5 text-accent hover:underline">
                      <Undo2 className="w-3.5 h-3.5" />
                      Undo: {undoStep.label}
                    </button>
                  )}
                  {actionHintFor(selectedEssay) && (
                    <span className="text-foreground/40">{actionHintFor(selectedEssay)}</span>
                  )}
                </div>
              )}

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
                <div className="flex items-start justify-between mb-3 gap-4 flex-wrap">
                  <span className="text-sm font-medium text-foreground/50 shrink-0">Draft</span>
                  <div className="flex-1 min-w-[240px]">
                    <LengthMeter assessment={lengthState} />
                  </div>
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
                {lengthState?.needsWork && lengthState.count > 0 && (
                  <div className="flex items-start gap-2.5 mt-3 p-3 rounded-lg bg-amber-50 border border-amber-200">
                    <Ruler className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
                    <div className="flex-1">
                      <p className="text-xs text-amber-800 leading-relaxed">
                        {lengthState.state === 'over'
                          ? `${lengthState.message} Cut the sentences that only announce meaning.`
                          : `${lengthState.message} A draft this far under its limit reads as unfinished, whatever the prose is like.`}
                      </p>
                      <button
                        onClick={handleFixLength}
                        disabled={busy !== null}
                        className="mt-1.5 text-xs font-medium text-amber-900 underline underline-offset-2 hover:text-amber-700 disabled:opacity-50"
                      >
                        {busy === 'repair' ? 'Working…' : lengthState.state === 'over' ? 'Trim it to the limit' : 'Ask the AI to finish the length'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
              )}

              {lengthIssue && !revision && (
                <div className="flex items-start gap-2.5 p-3.5 rounded-xl bg-amber-50 border border-amber-200">
                  <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
                  <p className="text-xs text-amber-800 leading-relaxed">
                    The AI answer did not meet the length contract: {lengthIssue.message}
                    {lengthIssue.shared
                      ? ' This box shares its budget with the other two UCAS answers.'
                      : ''}
                  </p>
                </div>
              )}

              {revision && (
                <EssayDiffView
                  revision={revision}
                  restoring={busy === 'restore'}
                  onKeep={() => setRevision(null)}
                  onRestore={revision.fromSnapshot ? null : (snapshot?.content ? handleRestoreSnapshot : null)}
                />
              )}

              <EssayReviewPanel
                reviewResult={reviewResult}
                cachedAt={reviewCachedAt}
                previousScore={previousScore}
                onPolish={handlePolish}
                polishing={editing}
                onReReview={selectedEssay.content ? handleReview : null}
                reReviewing={busy === 'review'}
              />

              <RevisionProgress
                entries={progress}
                onClear={() => {
                  clearEssayProgress(selectedEssay.id);
                  setProgress([]);
                  toast.success('Progress history cleared for this essay');
                }}
              />
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

            <div>
              <label className="block text-xs font-medium text-foreground/50 mb-1.5">What should this essay be rooted in?</label>
              <Textarea
                value={newEssay.draft_anchor}
                onChange={(e) => setNewEssay({ ...newEssay, draft_anchor: e.target.value })}
                placeholder="Write the moments, interests, questions, relationships, or qualities that must guide this essay."
                rows={4}
              />
              <p className="text-[11px] text-foreground/40 mt-1.5 leading-relaxed">
                This is your direction, not document text. Atlas will treat it as a hard constraint and use the materials to deepen it rather than choosing a random activity.
              </p>
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
        note: 'Nothing is shared on this platform, so every prompt comes from the university itself. Research the school in University Research and paste the exact prompts.',
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
