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
import { useBackgroundTasks } from '@/hooks/use-background-tasks';
import { startBackgroundTask, taskForEssay } from '@/lib/backgroundTasks';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import {
  Sparkles, FileText, Plus, Save, Wand2, ClipboardCheck, Loader2, PenLine,
  Trash2, ChevronDown, ChevronUp, Library, CheckCircle2, CircleDashed,
  Info, ArrowRight, AlertTriangle, Undo2, FileDiff, RotateCcw, Ruler, Compass, ListChecks,
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
  extractRevisedEssay, cleanEssayText, withMeasuredLength, buildRootCorrection, splitEditInstructions,
} from '@/lib/essayPrompts';
import { assessLength, isBetterLength, lengthSeverity } from '@/lib/essayLength';
import { checkDraftAgainstRoot, interpretRoot, rootCheckBrief } from '@/lib/essayRoot';
import { findUnaddressedFindings, unaddressedBrief, checkInstructionsFollowed, instructionsBrief } from '@/lib/essayEditCheck';
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
  getAutoRestoreWorseEdit, setAutoRestoreWorseEdit,
} from '@/lib/persist';

const statusLabel = (s) => (ESSAY_STATUSES.find((x) => x.value === s) || { label: s }).label;
const DRAFT_ANCHOR_KEY = 'atlas_draft_anchor_';

function localDraftAnchor(id) {
  if (!id || typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(`${DRAFT_ANCHOR_KEY}${id}`);
  } catch {
    return null;
  }
}

function rememberDraftAnchor(id, value) {
  if (!id || typeof window === 'undefined') return false;
  const serialized = String(value ?? '');
  try {
    window.localStorage.setItem(`${DRAFT_ANCHOR_KEY}${id}`, serialized);
    return window.localStorage.getItem(`${DRAFT_ANCHOR_KEY}${id}`) === serialized;
  } catch { return false; }
}

function clearLocalDraftAnchor(id) {
  if (!id || typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(`${DRAFT_ANCHOR_KEY}${id}`);
  } catch { /* a stale local fallback is still recoverable on this device */ }
}

// The applicant's edit instructions follow the same path as the root: the
// database column when it exists, this browser when it does not yet.
const EDIT_INSTRUCTIONS_KEY = 'atlas_edit_instructions_';

function localEditInstructions(id) {
  if (!id || typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(`${EDIT_INSTRUCTIONS_KEY}${id}`);
  } catch {
    return null;
  }
}

function rememberEditInstructions(id, value) {
  if (!id || typeof window === 'undefined') return false;
  const serialized = String(value ?? '');
  try {
    window.localStorage.setItem(`${EDIT_INSTRUCTIONS_KEY}${id}`, serialized);
    return window.localStorage.getItem(`${EDIT_INSTRUCTIONS_KEY}${id}`) === serialized;
  } catch { return false; }
}

function clearLocalEditInstructions(id) {
  if (!id || typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(`${EDIT_INSTRUCTIONS_KEY}${id}`);
  } catch { /* a stale local fallback is still recoverable on this device */ }
}

function hydrateEssay(essay) {
  if (!essay) return essay;
  const local = localDraftAnchor(essay.id);
  const localInstructions = localEditInstructions(essay.id);
  const withInstructions = {
    ...essay,
    edit_instructions: localInstructions !== null ? localInstructions : (essay.edit_instructions || ''),
  };
  if (local !== null) return { ...withInstructions, draft_anchor: local };
  return Object.prototype.hasOwnProperty.call(essay, 'draft_anchor')
    ? { ...withInstructions, draft_anchor: essay.draft_anchor || '' }
    : { ...withInstructions, draft_anchor: '' };
}

// The last AI edit of each essay, kept for the session so the comparison is
// still there when the applicant comes back to the essay — or to the page.
// A background edit that finishes while another essay is on screen writes
// here, and the essay shows it the moment it is selected.
const essayRevisions = new Map();

export default function EssayBuilder() {
  const [searchParams] = useSearchParams();
  const [universities, setUniversities] = useState([]);
  const [essays, setEssays] = useState([]);
  const [selectedUni, setSelectedUni] = useState(null);
  const [selectedEssay, setSelectedEssay] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirtyFields, setDirtyFields] = useState([]);
  const [rootSaving, setRootSaving] = useState(false);
  // Shown under the box as it is typed: what Atlas will read the direction as,
  // because "pick the best of these" and "cover all of these" look the same in a
  // list and produce completely different essays. Cheap to compute, and it lets the
  // applicant correct an ambiguous direction before spending a model call on it.
  const rootReading = useMemo(() => interpretRoot(selectedEssay?.draft_anchor || ''), [selectedEssay?.draft_anchor]);
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
  // Whether an edit that re-scores LOWER is put back by itself (the snapshot
  // keeps the edit either way).
  const [autoRestoreWorse, setAutoRestoreWorse] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [metaExpanded, setMetaExpanded] = useState(true);
  const [missingEssayColumns, setMissingEssayColumns] = useState([]);
  const [newEssay, setNewEssay] = useState({ title: '', type: 'supplemental', prompt: '', draft_anchor: '', word_limit: 650, scope: 'university_specific', limit_unit: 'words' });
  const autosaveRef = useRef(null);
  const selectedEssayRef = useRef(null);
  const dirtyFieldsRef = useRef([]);
  const essayWriteRef = useRef(Promise.resolve());
  const mountedRef = useRef(true);
  // Identifies this page instance to the task registry, so a task started by
  // an earlier visit can be told apart from one started here.
  const ownerRef = useRef(null);
  if (!ownerRef.current) ownerRef.current = `essay-builder-${Date.now().toString(36)}`;
  const dirty = dirtyFields.length > 0;
  const currentSelectedEssay = () => selectedEssayRef.current || selectedEssay;

  // AI work on an essay runs as a background task (see backgroundTasks.js): it
  // keeps going when the applicant switches essays or leaves the page, and it
  // locks ONE essay rather than the whole builder. `busy` is the stage of the
  // task that holds the selected essay — the same word the buttons always used.
  const backgroundTasks = useBackgroundTasks(useCallback((task) => {
    // A task started by an earlier visit to this page finished while this
    // visit is open: its result is in the database and the caches, not in this
    // instance's state. Re-read that one row (never the whole list, which would
    // discard what is being typed in another essay) and refresh its panels.
    if (task.kind !== 'essay' || task.owner === ownerRef.current || (task.state !== 'done' && task.state !== 'failed')) return;
    const essayId = String(task.scope?.essayId || '');
    if (!essayId) return;
    Promise.resolve(base44.entities.Essay.get(essayId)).then((raw) => {
      if (!raw || !mountedRef.current) return;
      const row = hydrateEssay(raw);
      setEssays((prev) => prev.map((item) => (String(item.id) === essayId ? { ...item, ...row } : item)));
      if (String(selectedEssayRef.current?.id || '') === essayId) {
        selectedEssayRef.current = row;
        setSelectedEssay(row);
        restoreEssayPanels(row);
      }
    }).catch(() => undefined);
  }, []));
  const essayTask = selectedEssay ? taskForEssay(selectedEssay.id) : null;
  const busy = essayTask?.stage || null;
  const runningEssayIds = new Set(backgroundTasks
    .filter((task) => task.kind === 'essay' && task.state === 'running')
    .map((task) => String(task.scope?.essayId || '')));

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  /** True while `essayId` is the essay on screen in a mounted builder. */
  const isShown = (essayId) => mountedRef.current && String(selectedEssayRef.current?.id || '') === String(essayId || '');

  /**
   * State setters bound to one essay. A background action finishes whether or
   * not the applicant has moved on, so a result for essay A must never land in
   * the panels showing essay B. Everything durable (text, review, snapshot,
   * progress) is persisted by the action itself; these only touch the screen.
   */
  const scopedSetters = (essayId) => {
    const guard = (setter) => (value) => { if (isShown(essayId)) setter(value); };
    return {
      setReviewResult: guard(setReviewResult),
      setReviewCachedAt: guard(setReviewCachedAt),
      setPreviousScore: guard(setPreviousScore),
      setGenAnalysis: guard(setGenAnalysis),
      setGenGaps: guard(setGenGaps),
      setGenCachedAt: guard(setGenCachedAt),
      setLengthIssue: guard(setLengthIssue),
      setSnapshot: guard(setSnapshot),
      setRevision: (value) => {
        const key = String(essayId);
        const next = typeof value === 'function' ? value(essayRevisions.get(key) || null) : value;
        if (next) essayRevisions.set(key, next); else essayRevisions.delete(key);
        if (isShown(essayId)) setRevision(next);
      },
    };
  };

  /**
   * Starts an AI action on an essay as a background task. Returns a promise
   * that settles when the action does; the UI never awaits it to stay usable.
   */
  const runEssayTask = (essay, { stage, label }, run) => {
    if (!essay?.id) return Promise.resolve(null);
    const running = taskForEssay(essay.id);
    if (running) {
      toast.message(`“${essay.title || 'This essay'}” is still being worked on`, {
        description: `${running.label} has not finished. You can edit any other essay in the meantime.`,
      });
      return Promise.resolve(null);
    }
    const { promise } = startBackgroundTask({
      kind: 'essay',
      label: `${label}: ${essay.title || 'Untitled essay'}`,
      stage,
      owner: ownerRef.current,
      scope: { essayId: String(essay.id), universityId: essay.university_id ? String(essay.university_id) : '' },
      run,
    });
    return promise.catch((error) => {
      console.error(error);
      return null;
    });
  };
  const updateDirtyFields = (update) => {
    const next = typeof update === 'function' ? update(dirtyFieldsRef.current) : update;
    dirtyFieldsRef.current = next;
    setDirtyFields(next);
  };

  useEffect(() => { selectedEssayRef.current = selectedEssay; }, [selectedEssay]);

  useEffect(() => {
    setAutoReview(getAutoReviewAfterEdit());
    setAutoRestoreWorse(getAutoRestoreWorseEdit());
  }, []);

  const platform = useMemo(() => getUniversityPlatform(selectedUni), [selectedUni]);
  const platformInfo = PLATFORMS[platform];
  // A shared essay is identical across its platform's schools, so its prompts
  // must not receive the currently selected university as an accidental target.
  const universityForEssay = (essay) => (essay && isSharedEssay(essay) ? null : selectedUni);

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
    setRevision(essay ? essayRevisions.get(String(essay.id)) || null : null);
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

  /** Everything the panels show for an essay, read back from its caches. */
  const restoreEssayPanels = (essay) => {
    const cachedReview = essay ? getCachedEssayReview(essay.id) : null;
    if (cachedReview?.result) {
      setReviewResult(cachedReview.result);
      setReviewCachedAt(cachedReview.savedAt || null);
    } else {
      setReviewResult(null);
      setReviewCachedAt(null);
    }
    const cachedGen = essay ? getCachedEssayGen(essay.id) : null;
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
  };

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const missing = typeof base44.capabilities?.probe === 'function'
          ? await base44.capabilities.probe()
          : (base44.capabilities?.missingOptionalColumns?.() || []);
        if (active) setMissingEssayColumns(missing.filter((column) => column === 'draft_anchor' || column === 'edit_instructions'));
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

  const pickEssay = async (essay) => {
    // A running AI task locks only its own essay, so switching is always
    // allowed; only a save in flight has to finish first.
    if (saving || rootSaving) return;
    const stayingInUcas = isUcasQuestion(essay) && isUcasQuestion(selectedEssay);
    if (dirty && !stayingInUcas) {
      if (!window.confirm('Save the current essay before switching?')) return;
      const saved = await handleSave();
      if (!saved) return;
    }
    selectedEssayRef.current = essay;
    setSelectedEssay(essay);
    setLastEssayId(essay.id);
    // Restore cached results for this essay if we have them
    restoreEssayPanels(essay);
    if (!stayingInUcas) updateDirtyFields([]);
  };

  const handleSelectUni = async (uniId) => {
    if (saving || rootSaving) return;
    if (dirty) {
      if (!window.confirm('Save the current essay before switching universities?')) return;
      const saved = await handleSave();
      if (!saved) return;
    }
    const uni = universities.find((u) => u.id === uniId);
    setSelectedUni(uni);
    if (uni) setLastUniversityId(uni.id);
    selectedEssayRef.current = null;
    setSelectedEssay(null);
    setReviewResult(null);
    setReviewCachedAt(null);
    setGenAnalysis(null);
    setGenGaps([]);
    setGenCachedAt(null);
    loadEssayLocalState(null);
    updateDirtyFields([]);
  };

  // --- persistence --------------------------------------------------------
  const clearDirtyFields = (savedFields, essayId = selectedEssay?.id) => {
    const fields = Array.isArray(savedFields) ? savedFields : Object.keys(savedFields || {});
    const values = Array.isArray(savedFields) ? null : (savedFields || {});
    updateDirtyFields((prev) => prev.filter((field) => {
      if (!fields.includes(field)) return true;
      const latest = selectedEssayRef.current;
      if (!latest || latest.id !== essayId) return true;
      return values ? latest[field] !== values[field] : false;
    }));
  };

  const markDirty = (field) => updateDirtyFields((prev) => (prev.includes(field) ? prev : [...prev, field]));

  // Serialize essay writes so an older debounced autosave cannot land after a
  // newer manual or AI save and roll the database back to stale text.
  const updateEssayInOrder = (id, fields) => {
    const operation = essayWriteRef.current
      .catch(() => undefined)
      .then(() => base44.entities.Essay.update(id, fields));
    essayWriteRef.current = operation.catch(() => undefined);
    return operation;
  };

  const mergePersistedFields = (current, essayRow, fields, updated) => {
    if (!current || current.id !== essayRow.id) return current;
    const next = { ...current };
    for (const [field, value] of Object.entries(fields)) {
      if (Object.is(current[field], essayRow[field]) || Object.is(current[field], value)) {
        next[field] = Object.prototype.hasOwnProperty.call(updated, field) ? updated[field] : value;
      }
    }
    if (updated.updated_at) next.updated_at = updated.updated_at;
    return next;
  };

  const preserveUnconfirmedSave = (essayRow, fields) => {
    const applyUnchangedFields = (current) => {
      if (!current || current.id !== essayRow.id) return current;
      const patch = {};
      for (const [field, value] of Object.entries(fields)) {
        if ((Object.is(current[field], essayRow[field]) || Object.is(current[field], value))
          && !Object.is(current[field], value)) patch[field] = value;
      }
      return Object.keys(patch).length ? { ...current, ...patch } : current;
    };
    setEssays((prev) => prev.map(applyUnchangedFields));
    setSelectedEssay(applyUnchangedFields);
    if (selectedEssayRef.current?.id === essayRow.id) {
      const retryable = Object.keys(fields).filter((field) => [
        'title', 'prompt', 'draft_anchor', 'edit_instructions', 'word_limit', 'content', 'status', 'type', 'limit_unit', 'review_notes',
      ].includes(field));
      updateDirtyFields((prev) => {
        const additions = retryable.filter((field) => !prev.includes(field));
        return additions.length ? [...prev, ...additions] : prev;
      });
    }
  };

  const persist = async (fields, essayRow = selectedEssay) => {
    if (!essayRow) return null;
    const savesRoot = Object.prototype.hasOwnProperty.call(fields, 'draft_anchor');
    if (savesRoot) rememberDraftAnchor(essayRow.id, fields.draft_anchor);
    const savesInstructions = Object.prototype.hasOwnProperty.call(fields, 'edit_instructions');
    if (savesInstructions) rememberEditInstructions(essayRow.id, fields.edit_instructions);
    let rootDurable = true;
    let updated;
    try {
      updated = await updateEssayInOrder(essayRow.id, fields);
    } catch (error) {
      preserveUnconfirmedSave(essayRow, fields);
      throw error;
    }
    if (!updated) {
      preserveUnconfirmedSave(essayRow, fields);
      throw new Error('Atlas could not confirm this essay save. Your changes remain in the editor; keep this page open and retry before switching devices.');
    }
    if (savesRoot) {
      const missing = base44.capabilities?.missingOptionalColumns?.() || [];
      const latestRoot = selectedEssayRef.current?.id === essayRow.id
        ? String(selectedEssayRef.current.draft_anchor || '')
        : String(essayRow.draft_anchor || '');
      const localRoot = localDraftAnchor(essayRow.id);
      const rootStillLatest = latestRoot === String(fields.draft_anchor || '')
        && (localRoot === null || localRoot === String(fields.draft_anchor || ''));
      const rootInDatabase = Object.prototype.hasOwnProperty.call(updated, 'draft_anchor')
        && !missing.includes('draft_anchor');
      if (rootInDatabase && rootStillLatest) {
        clearLocalDraftAnchor(essayRow.id);
      } else if (rootStillLatest) {
        rootDurable = rememberDraftAnchor(essayRow.id, fields.draft_anchor);
      }
    }
    if (savesInstructions) {
      // Same contract as the root: the browser copy is dropped only once the
      // database confirms it holds the latest text.
      const missing = base44.capabilities?.missingOptionalColumns?.() || [];
      const latest = selectedEssayRef.current?.id === essayRow.id
        ? String(selectedEssayRef.current.edit_instructions || '')
        : String(essayRow.edit_instructions || '');
      const inDatabase = Object.prototype.hasOwnProperty.call(updated, 'edit_instructions') && !missing.includes('edit_instructions');
      if (inDatabase && latest === String(fields.edit_instructions || '')) {
        clearLocalEditInstructions(essayRow.id);
        setMissingEssayColumns((prev) => prev.filter((column) => column !== 'edit_instructions'));
      } else if (!inDatabase) {
        setMissingEssayColumns((prev) => (prev.includes('edit_instructions') ? prev : [...prev, 'edit_instructions']));
      }
    }
    setEssays((prev) => prev.map((row) => mergePersistedFields(row, essayRow, fields, updated)));
    setSelectedEssay((prev) => mergePersistedFields(prev, essayRow, fields, updated));
    clearDirtyFields(rootDurable ? fields : Object.keys(fields).filter((field) => field !== 'draft_anchor'), essayRow.id);
    return updated;
  };

  /** Save the latest direction independently from the rest of the essay. */
  const saveRootForEssay = async (essayRow) => {
    if (!essayRow?.id) return { ok: false, persisted: false };
    const fields = { draft_anchor: String(essayRow.draft_anchor || '') };
    const locallySaved = rememberDraftAnchor(essayRow.id, fields.draft_anchor);
    setRootSaving(true);
    try {
      if (missingEssayColumns.includes('draft_anchor')) {
        if (!locallySaved) throw new Error('This browser could not store the root, and the database is missing the draft_anchor column. Run supabase/schema.sql and keep this page open.');
        clearDirtyFields(fields, essayRow.id);
        return { ok: true, persisted: false };
      }
      const updated = await updateEssayInOrder(essayRow.id, fields);
      if (!updated) throw new Error('Atlas could not confirm the database save. The root remains in the editor; keep this page open and retry.');
      const missing = base44.capabilities?.missingOptionalColumns?.() || [];
      const persisted = Object.prototype.hasOwnProperty.call(updated, 'draft_anchor') && !missing.includes('draft_anchor');
      const latestRoot = selectedEssayRef.current?.id === essayRow.id
        ? String(selectedEssayRef.current.draft_anchor || '')
        : String(essayRow.draft_anchor || '');
      const rootUnchanged = latestRoot === fields.draft_anchor;
      if (rootUnchanged) {
        setEssays((prev) => prev.map((row) => row.id === essayRow.id
          ? { ...row, draft_anchor: fields.draft_anchor, ...(updated.updated_at ? { updated_at: updated.updated_at } : {}) }
          : row));
        setSelectedEssay((prev) => prev?.id === essayRow.id
          ? { ...prev, draft_anchor: fields.draft_anchor, ...(updated.updated_at ? { updated_at: updated.updated_at } : {}) }
          : prev);
      }
      let localSaved = locallySaved;
      if (!persisted) {
        if (rootUnchanged) localSaved = rememberDraftAnchor(essayRow.id, fields.draft_anchor);
        setMissingEssayColumns((prev) => (prev.includes('draft_anchor') ? prev : [...prev, 'draft_anchor']));
      } else {
        if (rootUnchanged) clearLocalDraftAnchor(essayRow.id);
        setMissingEssayColumns((prev) => prev.filter((column) => column !== 'draft_anchor'));
      }
      const savedSomewhere = persisted || localSaved;
      clearDirtyFields(savedSomewhere ? fields : [], essayRow.id);
      if (!savedSomewhere && rootUnchanged) {
        throw new Error('Neither the database nor this browser could store the essay root. Run supabase/schema.sql and keep this page open.');
      }
      return { ok: savedSomewhere, persisted, error: persisted ? null : undefined };
    } catch (error) {
      return { ok: locallySaved, persisted: false, error };
    } finally {
      setRootSaving(false);
    }
  };

  const prepareEssayRoot = async (essayRow) => {
    const latest = selectedEssayRef.current?.id === essayRow?.id ? selectedEssayRef.current : essayRow;
    const target = { ...latest };
    const pendingFields = dirtyFieldsRef.current
      .filter((field) => field !== 'draft_anchor' && Object.prototype.hasOwnProperty.call(target, field));
    if (pendingFields.length) {
      if (isUcasQuestion(target)) {
        const rows = essays
          .filter(isUcasQuestion)
          .map((essay) => (essay.id === target.id ? { ...essay, ...target } : essay));
        await persistUcasRows(rows, target.id);
      } else {
        const fields = Object.fromEntries(pendingFields.map((field) => [field, target[field]]));
        await persist(fields, target);
      }
    }
    const result = await saveRootForEssay(target);
    if (!result.ok) {
      const error = result.error || new Error('The essay root could not be saved.');
      toast.error('Essay root was not saved', { description: `${error.message} This draft was not started.` });
      throw error;
    }
    if (result.error) {
      toast.warning('Root saved in this browser; database sync failed', {
        description: `${result.error.message} The AI will use this root for this draft. Check the connection before switching devices.`,
      });
    } else if (!result.persisted) {
      toast.message('Root saved in this browser', {
        description: 'Run supabase/schema.sql to sync this direction across devices. The AI will use this saved root now.',
      });
    }
    return { ...target, draft_anchor: String(target?.draft_anchor || '') };
  };

  const handleSaveRoot = async () => {
    const target = currentSelectedEssay();
    if (!target) return;
    const result = await saveRootForEssay(target);
    if (!result.ok) {
      toast.error('Could not save essay root', {
        description: `${result.error?.message || 'The save could not be confirmed.'} The root remains in the editor; keep this page open and retry.`,
      });
      return;
    }
    if (result.error) {
      toast.warning('Essay root saved in this browser', {
        description: `Database sync failed: ${result.error.message} The AI can use this root on this device.`,
      });
      return;
    }
    toast.success(result.persisted ? 'Essay root saved' : 'Essay root saved in this browser', {
      description: result.persisted
        ? 'This is the direction future drafts will start from.'
        : 'The AI will use this root here. Run supabase/schema.sql to sync it across devices.',
    });
  };

  const handleFieldChange = (field, value) => {
    const essayId = selectedEssay?.id;
    if (field === 'draft_anchor') rememberDraftAnchor(essayId, value);
    if (field === 'edit_instructions') rememberEditInstructions(essayId, value);
    if (selectedEssayRef.current?.id === essayId) {
      selectedEssayRef.current = { ...selectedEssayRef.current, [field]: value };
    }
    setEssays((prev) => prev.map((item) => (item.id === essayId ? { ...item, [field]: value } : item)));
    setSelectedEssay((prev) => ({ ...prev, [field]: value }));
    markDirty(field);
  };

  const onUcasChange = (essay, content) => {
    setEssays((prev) => prev.map((item) => (item.id === essay.id ? { ...item, content } : item)));
    if (selectedEssayRef.current?.id === essay.id) {
      selectedEssayRef.current = { ...selectedEssayRef.current, content };
    }
    setSelectedEssay((prev) => (prev?.id === essay.id ? { ...prev, content } : prev));
    markDirty('content');
  };

  const onUcasFocus = (essay) => {
    if (!essay || selectedEssay?.id === essay.id) return;
    selectedEssayRef.current = essay;
    setSelectedEssay(essay);
    setReviewResult(null);
    setGenAnalysis(null);
    setGenGaps([]);
    loadEssayLocalState(essay);
  };

  const essaySaveFields = (essay) => ({
    title: essay.title,
    prompt: essay.prompt,
    draft_anchor: essay.draft_anchor || '',
    edit_instructions: essay.edit_instructions || '',
    word_limit: resolvedEssayLimit(essay),
    content: essay.content,
    status: essay.status,
    review_notes: essay.review_notes || '',
    type: essay.type,
    limit_unit: limitUnitFor(essay),
  });

  const persistUcasRows = async (rows, activeEssayId) => {
    for (const essay of rows) {
      const fields = {
        content: essay.content,
        prompt: essay.prompt,
        title: essay.title,
        draft_anchor: essay.draft_anchor || '',
        edit_instructions: essay.edit_instructions || '',
        word_limit: resolvedEssayLimit(essay),
        status: essay.status,
        review_notes: essay.review_notes || '',
        type: essay.type,
        limit_unit: 'characters',
      };
      await persist(fields, essay);
      const rootColumnMissing = (base44.capabilities?.missingOptionalColumns?.() || []).includes('draft_anchor');
      if (rootColumnMissing && essay.draft_anchor
        && localDraftAnchor(essay.id) !== String(essay.draft_anchor)) {
        throw new Error('This browser could not store a UCAS essay root while the database is missing draft_anchor. Run supabase/schema.sql and keep this page open.');
      }
      if (essay.id === activeEssayId) clearDirtyFields(fields, essay.id);
    }
  };

  const handleSave = async () => {
    const current = currentSelectedEssay();
    if (!current) return false;
    const target = { ...current };
    setSaving(true);
    try {
      if (isUcasQuestion(target)) {
        const rows = essays
          .filter(isUcasQuestion)
          .map((essay) => (essay.id === target.id ? { ...essay, ...target } : essay));
        await persistUcasRows(rows, target.id);
      } else {
        await persist(essaySaveFields(target), target);
      }
      if (dirtyFieldsRef.current.length) {
        toast.warning('Some essay changes are still not confirmed', {
          description: 'The latest root or text remains in the editor. Check the save status and retry before switching essays or universities.',
        });
        return false;
      }
      toast.success('Essay saved');
      return true;
    } catch (e) {
      toast.error('Could not save this essay', { description: e.message });
      return false;
    } finally {
      setSaving(false);
    }
  };

  // Debounced autosave so nothing is ever lost to a stray click. A save clears
  // only fields whose current value still matches the snapshot sent to storage.
  useEffect(() => {
    if (busy !== null || saving || rootSaving || !dirtyFields.length || !selectedEssay) return undefined;
    const missingRootColumn = missingEssayColumns.includes('draft_anchor')
      || (base44.capabilities?.missingOptionalColumns?.() || []).includes('draft_anchor');
    const rootUnavailable = missingRootColumn
      && dirtyFieldsRef.current.every((field) => field === 'draft_anchor')
      && dirtyFieldsRef.current.includes('draft_anchor')
      && localDraftAnchor(selectedEssay.id) !== String(selectedEssay.draft_anchor || '');
    if (rootUnavailable) return undefined;
    clearTimeout(autosaveRef.current);
    const target = { ...selectedEssay };
    autosaveRef.current = setTimeout(async () => {
      try {
        if (isUcasQuestion(target)) {
          const rows = essays
            .filter(isUcasQuestion)
            .map((essay) => (essay.id === target.id ? { ...essay, ...target } : essay));
          await persistUcasRows(rows, target.id);
        } else {
          await persist({
            content: target.content,
            prompt: target.prompt,
            title: target.title,
            draft_anchor: target.draft_anchor || '',
            edit_instructions: target.edit_instructions || '',
            word_limit: target.word_limit,
            status: target.status,
            review_notes: target.review_notes || '',
            type: target.type,
            limit_unit: limitUnitFor(target),
          }, target);
        }
      } catch { /* autosave failures must not interrupt typing; dirty remains visible */ }
    }, 2500);
    return () => clearTimeout(autosaveRef.current);
  }, [busy, dirtyFields, essays, selectedEssay, saving, rootSaving, missingEssayColumns]);

  // --- context ------------------------------------------------------------
  const gatherContext = async (essayRow = selectedEssay, task = 'draft') => {
    const [profiles, materials] = await Promise.all([
      base44.entities.Profile.list(),
      base44.entities.Material.list(),
    ]);
    const profileText = buildProfileContext(profiles[0] || {}, { includeLeadershipBrief: true });
    const contextUniversity = essayRow && isSharedEssay(essayRow) ? null : selectedUni;
    const contextPlatform = essayRow?.application_platform || platform;
    const targeting = {
      platform: contextPlatform,
      universityId: contextUniversity?.id || '',
      universityName: contextUniversity?.name || '',
      essayId: essayRow?.id || '',
      essay: essayRow || null,
      task,
      universities,
      essays,
    };
    const materialsText = formatMaterialsForAI(materials, targeting);
    const knowledgeRows = await base44.entities.CollegeKnowledge.list();
    const knowledge = contextUniversity
      ? findKnowledgeRecord(knowledgeRows, contextUniversity.name || '')
      : null;
    const knowledgeText = knowledge?.knowledge
      || (contextUniversity
        ? 'No university research is cached for this university yet. Research it in University Research for a far more specific essay — this draft will rely on general knowledge only.'
        : 'No university research applies to a shared essay.');
    const applicantText = await loadApplicantKnowledgeText(targeting);
    return { profileText, materialsText, knowledgeText, applicantText };
  };

  // --- guards and undo ----------------------------------------------------
  /** Demo output is placeholder text: nothing is written, reviewed, or edited with it. */
  const guardLive = (action) => {
    if (hasLiveModel()) return true;
    toast.error(`${action} needs a connected AI model`, {
      description: 'Demo mode shows placeholder text, so Atlas will not write, review, or edit an essay with it. Nothing was changed. Connect an AI provider in AI setup (AI status in the sidebar).',
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
    if (!undoStep || saving || rootSaving) return;
    if (taskForEssay(undoStep.essayId)) return;
    const { essayId, fields, label } = undoStep;
    const target = selectedEssay?.id === essayId ? selectedEssay : essays.find((essay) => essay.id === essayId);
    if (!target) return;
    setSaving(true);
    try {
      await persist(fields, target);
      if (selectedEssay?.id === essayId) {
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
    } finally {
      setSaving(false);
    }
  };

  /** Why the drafting actions are unavailable right now, in one sentence. */
  const actionHintFor = (essay) => {
    if (!hasLiveModel()) return 'Demo mode: connect an AI provider in AI setup to generate, review, or edit.';
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
        essay, university: universityForEssay(essay), platform, mode, text, assessment,
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
    if (isShown(essayId)) setProgress(next);
    return next;
  };

  const handleGenerate = async () => {
    const current = currentSelectedEssay();
    if (!current) return;
    if (!guardLive('Generate a draft')) return;
    const essayTarget = { ...current };
    if (!confirmReplace(essayTarget, 'the draft is written')) return;
    if (isCommonAppPersonalStatement(essayTarget) && !chosenCommonAppPrompt(essayTarget)) {
      toast.error('Choose one Common App prompt first', {
        description: 'The personal statement answers one of the seven prompts. Leaving all of them in the box makes the draft try to answer every prompt.',
      });
      return;
    }
    if (isAmbiguousCommonAppPrompt(essayTarget.prompt)) {
      toast.error('This essay has more than one official prompt in it', {
        description: 'Choose the single prompt you are answering before generating a draft.',
      });
      return;
    }
    const before = essayTarget.content || '';
    const ui = scopedSetters(essayTarget.id);
    const priorReviewForDraft = reviewResult;
    ui.setReviewResult(null);
    ui.setGenAnalysis(null);
    ui.setRevision(null);
    ui.setLengthIssue(null);
    return runEssayTask(essayTarget, { stage: 'generate', label: 'Writing a draft' }, async ({ setStage }) => {
    try {
      const essayForAction = await prepareEssayRoot(essayTarget);
      const context = await gatherContext(essayForAction, 'draft');
      const editInstructions = essayForAction.edit_instructions || '';
      const outcome = await runAI({
        prompt: buildGeneratePrompt({
          essay: essayForAction, university: universityForEssay(essayForAction), platform,
          profileText: context.profileText, knowledgeText: context.knowledgeText,
          materialsText: context.materialsText, applicantText: context.applicantText,
          allEssays: essays, editInstructions,
        }),
        response_json_schema: GENERATE_SCHEMA,
        temperature: AI_TEMPERATURES.generate,
      }, { fallbackTitle: 'Could not generate a draft' });

      if (!isLiveOutcome(outcome)) return;
      let text = cleanEssayText(extractRevisedEssay(outcome.result));
      if (!text) {
        toast.error('The AI returned an empty draft', { description: 'Try again, or lower the length you asked for.' });
        return;
      }
      // Atlas then checks the answer against the direction the applicant wrote in
      // the root box — not whether the words appear, but whether the essay was
      // BUILT on one option when it was told to choose one. A draft that failed
      // that check is sent back once before anything else is done to it, because
      // a beautiful essay about the wrong subject still has to be thrown away.
      let rootCheck = checkDraftAgainstRoot(essayForAction.draft_anchor || '', text);
      let rootNote = rootCheckBrief(rootCheck);
      let result = outcome.result && typeof outcome.result === 'object' ? outcome.result : {};
      let rootRetried = false;
      if (!rootCheck.ok && rootCheck.correction) {
        setStage('generate');
        const retry = await runAI({
          prompt: buildGeneratePrompt({
            essay: essayForAction, university: universityForEssay(essayForAction), platform,
            profileText: context.profileText, knowledgeText: context.knowledgeText,
            materialsText: context.materialsText, applicantText: context.applicantText,
            allEssays: essays, rootCorrection: buildRootCorrection(rootCheck), editInstructions,
          }),
          response_json_schema: GENERATE_SCHEMA,
          temperature: AI_TEMPERATURES.generate,
        }, { fallbackTitle: 'The second draft could not be completed' });
        if (isLiveOutcome(retry)) {
          const candidate = cleanEssayText(extractRevisedEssay(retry.result));
          const candidateCheck = candidate ? checkDraftAgainstRoot(essayForAction.draft_anchor || '', candidate) : null;
          const candidateLength = candidate ? assessLength(candidate, essayForAction, essays) : null;
          // Keep the retry only when it actually follows the direction and does
          // not hand back a shorter essay than the one it replaces.
          if (candidate && candidateCheck?.ok
            && lengthSeverity(candidateLength) <= lengthSeverity(assessLength(text, essayForAction, essays))) {
            text = candidate;
            result = retry.result && typeof retry.result === 'object' ? retry.result : result;
            rootCheck = candidateCheck;
            rootNote = rootCheckBrief(candidateCheck);
            rootRetried = true;
          }
        }
      }
      let assessment = assessLength(text, essayForAction, essays);
      let repaired = false;
      let repairNotes = '';
      if (assessment.needsWork || outcome.meta?.truncated) {
        setStage('repair');
        const fix = await repairLength({ essay: essayForAction, context, text, assessment, mode: 'generate' });
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

      // The applicant's own instructions are checked against the draft, not
      // taken from the model's report: a missed one is listed with the gaps.
      const instructionCheck = checkInstructionsFollowed(splitEditInstructions(editInstructions), before, text, result);
      const instructionNote = instructionsBrief(instructionCheck);
      const analysis = [result.essay_analysis || '', repairNotes, instructionNote].filter(Boolean).join('\n\n');
      const gaps = [
        ...(Array.isArray(result.gaps_for_applicant) ? result.gaps_for_applicant : []),
        ...instructionCheck.items.filter((item) => item.status === 'missed').map((item) => `Your instruction was not carried out: “${item.instruction}” — ${item.detail}`),
      ];
      ui.setGenAnalysis(analysis);
      ui.setGenGaps(gaps);
      ui.setGenCachedAt(new Date().toISOString());
      setCachedEssayGen(essayForAction.id, { analysis, gaps });

      if (before.trim()) {
        setEssaySnapshot(essayForAction.id, { content: before, label: 'the text before this draft', review: priorReviewForDraft });
        ui.setSnapshot(getEssaySnapshot(essayForAction.id));
      }
      rememberForUndo(essayForAction, { content: before, status: essayForAction.status }, 'draft written');
      await persist({ content: text, status: 'drafting' }, essayForAction);

      recordProgress(essayForAction.id, {
        action: 'generate',
        unit: assessment.unit,
        wordsBefore: assessLength(before, essayForAction, essays).count,
        wordsAfter: assessment.count,
        scoreBefore: priorReviewForDraft?.overall_score ?? null,
        scoreAfter: null,
        rootRetried,
        note: [
          rootRetried ? 're-drafted to follow your required root' : '',
          repaired ? 'length repaired automatically' : '',
          assessment.ok ? 'inside the target band' : 'still outside the target band',
          instructionCheck.missed ? `${instructionCheck.missed} instruction(s) not carried out` : '',
        ].filter(Boolean).join(' · '),
      });
      ui.setLengthIssue(assessment.ok ? null : assessment);

      if (!assessment.ok) {
        toast.warning(`Draft written, but it is ${assessment.shortfall ? `${assessment.shortfall.toLocaleString()} ${formatLimit(assessment.unit)} short` : `${assessment.overage.toLocaleString()} ${formatLimit(assessment.unit)} over`}`, {
          description: `${assessment.message} Use “Fix length” below — Atlas will ask the model to finish the job properly.`,
          duration: 12000,
        });
      } else if (rootRetried) {
        toast.success(`Draft rewritten on your required root — ${assessment.count.toLocaleString()} ${formatLimit(assessment.unit)}`, {
          description: `The first answer ignored the direction in the root box, so Atlas sent it back. ${rootNote}`,
          duration: 12000,
        });
      } else if (instructionCheck.missed) {
        toast.warning(`Draft written, but ${instructionCheck.missed} of your instruction${instructionCheck.missed === 1 ? ' was' : 's were'} not followed`, {
          description: `${instructionNote} They are listed under “fill these in”; “Apply edits” will hold the editor to them.`,
          duration: 12000,
        });
      } else {
        toast.success(`Draft written — ${assessment.count.toLocaleString()} ${formatLimit(assessment.unit)}`, {
          description: gaps.length
            ? 'Check the "fill these in" list — the AI deliberately left gaps rather than inventing your life.'
            : 'Inside the target band, and built on the root you set. Read it, then edit it in your own voice.',
        });
      }
    } catch (e) {
      console.error(e);
    }
    });
  };

  /**
   * Runs the admissions review and stores it. Takes the essay explicitly so the
   * automatic re-review after an edit can score the text that was just saved
   * rather than the copy still held in this render's state.
   */
  const runReview = async (essayRow, previousReview = null, task = 'review') => {
    let target = essayRow || selectedEssay;
    if (!target?.content?.trim()) return null;
    target = await prepareEssayRoot({ ...target });
    const context = await gatherContext(target, task);
    const rows = essays.map((row) => (row.id === target.id ? { ...row, content: target.content } : row));
    const outcome = await runAI({
      prompt: buildReviewPrompt({
        essay: target, university: universityForEssay(target), platform,
        knowledgeText: context.knowledgeText, reviewNotes: target.review_notes,
        allEssays: rows, materialsText: context.materialsText,
        profileText: context.profileText, applicantText: context.applicantText,
        previousReview,
      }),
      response_json_schema: REVIEW_SCHEMA,
      temperature: AI_TEMPERATURES.review,
    }, { fallbackTitle: 'The review could not be completed' });

    if (!isLiveOutcome(outcome)) return null;
    const measured = withMeasuredLength(outcome.result, target, rows);
    const ui = scopedSetters(target.id);
    ui.setReviewResult(measured);
    ui.setReviewCachedAt(new Date().toISOString());
    setCachedEssayReview(target.id, measured);
    return measured;
  };

  const handleReview = async () => {
    const current = currentSelectedEssay();
    if (!current?.content) return;
    if (!guardLive('The admissions review')) return;
    const target = { ...current };
    const prior = reviewResult;
    const ui = scopedSetters(target.id);
    ui.setReviewResult(null);
    return runEssayTask(target, { stage: 'review', label: 'Admissions review' }, async () => {
    try {
      const measured = await runReview(target, prior, 'review');
      if (!measured) {
        if (prior) ui.setReviewResult(prior);
        return;
      }
      ui.setPreviousScore(prior?.overall_score ?? null);
      rememberForUndo(target, { status: target.status, review_notes: target.review_notes || '' }, 'review saved');
      await persist({ status: 'in_review', review_notes: JSON.stringify(measured, null, 2) }, target);
      recordProgress(target.id, {
        action: 'review',
        unit: measured.unit,
        wordsBefore: measured.word_count,
        wordsAfter: measured.word_count,
        scoreBefore: prior?.overall_score ?? null,
        scoreAfter: measured.overall_score,
      });
      const delta = prior?.overall_score > 0 ? Math.round((measured.overall_score - prior.overall_score) * 10) / 10 : null;
      toast.success(`Reviewed “${target.title || 'essay'}”: ${measured.overall_score}/10${delta === null ? '' : ` (${delta > 0 ? '+' : ''}${delta})`}`, {
        description: `${(measured.weaknesses || []).length} weakness(es) and ${(measured.priority_improvements || []).length} priority fix(es) found.`,
      });
    } catch (e) {
      console.error(e);
      if (prior) ui.setReviewResult(prior);
    }
    });
  };

  /**
   * One AI edit pass.
   *
   * `focusPhrases` turns the same pipeline into the follow-up edit: the flagged
   * phrases that are still in the draft, and nothing else. Keeping both in one
   * function is deliberate — the follow-up gets the same snapshot, the same
   * conservation diff, the same length contract, and the same re-score, so an
   * applicant never gets a weaker safety net for the second pass than the first.
   */
  const runPolishAction = async ({ focusPhrases = null, focusInstructions = null, label = 'Apply edits' } = {}) => {
    const current = currentSelectedEssay();
    if (!current?.content?.trim()) return;
    if (!guardLive(label)) return;
    const essayTarget = { ...current };
    const followUp = !!(focusPhrases?.length || focusInstructions?.length);
    if (!followUp && !confirmReplace(essayTarget, 'the edits are applied')) return;
    const before = essayTarget.content || '';
    const priorReview = reviewResult;
    const ui = scopedSetters(essayTarget.id);
    ui.setLengthIssue(null);
    return runEssayTask(essayTarget, { stage: 'polish', label: followUp ? 'Follow-up edit' : 'Applying edits' }, async ({ setStage }) => {
    try {
      const essayForAction = await prepareEssayRoot(essayTarget);
      const context = await gatherContext(essayForAction, 'polish');
      // The applicant's own change list. A follow-up narrows it to the
      // instructions the first pass missed; a first pass carries all of them.
      const editInstructions = focusInstructions?.length
        ? focusInstructions.join('\n')
        : (essayForAction.edit_instructions || '');
      const instructionList = splitEditInstructions(editInstructions);
      const outcome = await runAI({
        prompt: buildPolishPrompt({
          essay: essayForAction, university: universityForEssay(essayForAction), platform,
          reviewResult: priorReview, knowledgeText: context.knowledgeText, allEssays: essays,
          materialsText: context.materialsText, profileText: context.profileText,
          applicantText: context.applicantText,
          focusPhrases: focusPhrases?.length ? focusPhrases : null,
          focusInstructions: focusInstructions?.length ? focusInstructions : null,
          editInstructions,
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
      let assessment = assessLength(text, essayForAction, essays);
      let repaired = false;
      if (assessment.needsWork || outcome.meta?.truncated) {
        // An edit that shrinks the essay below its target band is the exact
        // failure this feature exists to prevent, so it is repaired before it
        // is ever shown as finished.
        setStage('repair');
        const firstStats = diffStats(diffText(before, text).ops);
        const fix = await repairLength({
          essay: essayForAction, context, text, assessment, mode: 'edit',
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
      // The measure of an edit is whether it fixed what was wrong, so Atlas
      // checks the review's own quoted phrases against the text it got back
      // instead of reading the model's change log and hoping.
      const unaddressed = findUnaddressedFindings(priorReview, text, before);
      // And the applicant's own instructions, checked the same way: against the
      // text, with the model's report used only where there is nothing to check.
      const instructionCheck = checkInstructionsFollowed(instructionList, before, text, result);
      const claim = String(result.improvement_claim || '').toLowerCase();

      setEssaySnapshot(essayForAction.id, { content: before, label: 'your version before this edit', review: priorReview });
      ui.setSnapshot(getEssaySnapshot(essayForAction.id));
      rememberForUndo(essayForAction, { content: before, status: essayForAction.status },
        followUp ? 'follow-up edits applied' : 'edits applied');
      await persist({ content: text, status: 'polishing' }, essayForAction);

      ui.setRevision({
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
        followUp,
        unaddressed: unaddressed.stillPresent,
        resolvedPhrases: unaddressed.fixed,
        refused: Array.isArray(result.unresolved_phrases) ? result.unresolved_phrases : [],
        unaddressedNote: unaddressedBrief(unaddressed),
        instructionCheck: instructionCheck.hadNothing ? null : instructionCheck,
        improvementClaim: claim || null,
      });
      ui.setLengthIssue(assessment.ok ? null : assessment);

      if (rewritten) {
        toast.warning('The editor rewrote most of your draft', {
          description: `Only ${Math.round(stats.preservedRatio * 100)}% of your words survived, and Atlas asked it to keep at least 80%. The comparison below highlights everything it touched — restore your version if you prefer it.`,
          duration: 14000,
        });
      } else if (instructionCheck.missed) {
        toast.warning(`Revision applied, but ${instructionCheck.missed} of your instruction${instructionCheck.missed === 1 ? ' was' : 's were'} not carried out`, {
          description: `${instructionsBrief(instructionCheck)} The comparison lists each one; the follow-up button sends only those back.`,
          duration: 14000,
        });
      } else if (unaddressed.stillPresent.length) {
        toast.warning('Revision applied, but the review is not answered yet', {
          description: `${unaddressed.message} The remaining ones are listed under the comparison — “Fix what is still flagged” edits only those.`,
          duration: 14000,
        });
      } else if (claim === 'unchanged') {
        toast.message('Revision applied — the editor itself does not claim an improvement', {
          description: 'It says it only touched wording that was already working. The re-score below is the measure; restore your version if it does not move.',
          duration: 12000,
        });
      } else {
        toast.success('Revision applied', {
          description: `${stats.kept} of your ${stats.oldTotal} ${formatLimit(assessment.unit)} kept, ${stats.added} added, ${stats.removed} cut${unaddressed.fixed.length ? `, and all ${unaddressed.fixed.length} flagged phrase(s) the review objected to are gone` : ''}${instructionCheck.total ? `, and your ${instructionCheck.total} instruction${instructionCheck.total === 1 ? '' : 's'} accounted for` : ''}. Every change is highlighted below.`,
        });
      }

      // The whole point of an edit is a better essay, so measure it on the same
      // rubric instead of leaving the applicant to guess.
      const updatedEssay = { ...essayForAction, content: text, status: 'polishing' };
      let nextReview = null;
      if (autoReview && hasLiveModel()) {
        setStage('re_review');
        try {
          nextReview = await runReview(updatedEssay, priorReview, 'review');
          if (nextReview) {
            ui.setPreviousScore(priorReview?.overall_score ?? null);
            await persist({ status: 'in_review', review_notes: JSON.stringify(nextReview, null, 2) }, updatedEssay);
          } else if (priorReview) {
            ui.setReviewResult(priorReview);
          }
        } catch (e) {
          // The edit itself succeeded and is already on screen; a failed
          // re-review is reported, not allowed to hide the diff.
          console.error(e);
          if (priorReview) ui.setReviewResult(priorReview);
          toast.warning('The edit was applied, but the automatic re-score failed', {
            description: 'Use "Admissions review" to score it again.',
            duration: 10000,
          });
        }
      }

      recordProgress(essayForAction.id, {
        action: followUp ? 'follow-up' : 'edit',
        unit: assessment.unit,
        wordsBefore: assessLength(before, essayForAction, essays).count,
        wordsAfter: assessment.count,
        scoreBefore: priorReview?.overall_score ?? null,
        scoreAfter: nextReview?.overall_score ?? null,
        preservedRatio: stats.preservedRatio,
        note: [
          focusPhrases?.length ? `follow-up on ${focusPhrases.length} flagged phrase(s)` : '',
          focusInstructions?.length ? `follow-up on ${focusInstructions.length} missed instruction(s)` : '',
          repaired ? 'length repaired automatically' : '',
          rewritten ? 'rewrote more than expected' : '',
          unaddressed.stillPresent.length ? `${unaddressed.stillPresent.length} still unaddressed` : '',
          instructionCheck.missed ? `${instructionCheck.missed} instruction(s) not carried out` : '',
        ].filter(Boolean).join(' · '),
      });

      if (nextReview) {
        const beforeScore = Number(priorReview?.overall_score) || 0;
        const afterScore = Number(nextReview.overall_score) || 0;
        const delta = beforeScore > 0 ? Math.round((afterScore - beforeScore) * 10) / 10 : null;
        // The score belongs on the comparison, not only in a toast that disappears
        // while it is being read: an edit is judged by whether the same rubric now
        // says more, and the applicant must be able to see the number afterwards.
        ui.setRevision((prev) => (prev ? {
          ...prev, scoreBefore: beforeScore || null, scoreAfter: afterScore || null, scoreDelta: delta,
        } : prev));
        if (delta !== null && delta < 0) {
          // A lower score is the one outcome that is never an improvement. With
          // the automatic restore on, the applicant's own text goes back and the
          // rejected edit becomes the snapshot, so nothing is lost either way.
          if (autoRestoreWorse) {
            setStage('restore');
            try {
              await persist({ content: before, status: 'polishing' }, updatedEssay);
              setEssaySnapshot(essayForAction.id, { content: text, label: 'the AI edit that scored lower', review: nextReview });
              ui.setSnapshot(getEssaySnapshot(essayForAction.id));
              rememberForUndo(essayForAction, { content: text, status: 'polishing' }, 'the lower-scoring AI edit re-applied');
              if (priorReview) {
                const measured = withMeasuredLength(priorReview, { ...essayForAction, content: before }, essays);
                ui.setReviewResult(measured);
                setCachedEssayReview(essayForAction.id, measured);
                await persist({ status: 'in_review', review_notes: JSON.stringify(measured, null, 2) }, { ...updatedEssay, content: before, status: 'polishing' });
              }
              ui.setPreviousScore(null);
              ui.setRevision((prev) => (prev ? { ...prev, autoRestored: true } : prev));
              recordProgress(essayForAction.id, {
                action: 'restore',
                unit: assessment.unit,
                wordsBefore: assessment.count,
                wordsAfter: assessLength(before, essayForAction, essays).count,
                scoreBefore: afterScore || null,
                scoreAfter: beforeScore || null,
                note: 'edit scored lower, so your version was put back automatically',
              });
              toast.warning(`The edit scored lower (${beforeScore} → ${afterScore}/10), so your version is back`, {
                description: 'Not an improvement, so it was not kept. The rejected edit is still there under “Compare with the AI edit that scored lower” if you want to look at it.',
                duration: 14000,
              });
            } catch (restoreError) {
              console.error(restoreError);
              toast.warning(`The revision scored lower: ${beforeScore} → ${afterScore}/10`, {
                description: 'Atlas could not put your version back by itself. Use “Restore it” below.',
                duration: 14000,
              });
            }
          } else {
            toast.warning(`The revision scored lower: ${beforeScore} → ${afterScore}/10`, {
              description: 'This is not an improvement. Restore your version below, or apply edits again — the new review says exactly what is wrong now.',
              duration: 14000,
            });
          }
        } else if (delta !== null && delta > 0) {
          toast.success(`Re-scored after the edit: ${beforeScore} → ${afterScore}/10 (+${delta})`, {
            description: 'Same rubric, same scale, measured on the text now in the editor.',
          });
        } else if (delta === 0) {
          toast.message(`Re-scored after the edit: still ${afterScore}/10`, {
            description: 'No measured improvement. Keep the edit only if you can see a change you want; otherwise restore your version.',
            duration: 12000,
          });
        } else {
          toast.success(`Re-scored after the edit: ${afterScore}/10`);
        }
      }
    } catch (e) {
      console.error(e);
    }
    });
  };

  /** The normal "Apply edits" action. */
  const handlePolish = () => runPolishAction({});

  /**
   * The follow-up: edit only the phrases the review objected to that are still in
   * the draft. This is what closes the loop: an edit that
   * polishes prose while leaving every flagged line alone, and a score that never
   * moves. The same conservation rules and the same snapshot apply, so a
   * follow-up can never quietly become a rewrite.
   */
  const handleFinishFlagged = () => {
    const still = (revision?.unaddressed?.length
      ? revision.unaddressed
      : findUnaddressedFindings(reviewResult, selectedEssay?.content || '').stillPresent);
    const missedInstructions = (revision?.instructionCheck?.items || [])
      .filter((item) => item.status === 'missed')
      .map((item) => item.instruction);
    if (!still?.length && !missedInstructions.length) {
      toast.message('There is nothing left to fix', {
        description: 'Every phrase the review flagged is already out of the draft, and your instructions were carried out. Run an admissions review to look for new ones.',
      });
      return;
    }
    return runPolishAction({
      focusPhrases: still?.length ? still : null,
      focusInstructions: missedInstructions.length ? missedInstructions : null,
      label: 'The follow-up edit',
    });
  };

  /** Brings the current text to its length contract on demand. */
  const handleFixLength = async () => {
    const current = currentSelectedEssay();
    if (!current?.content?.trim()) return;
    if (!guardLive('The length fix')) return;
    const essayTarget = { ...current };
    const before = essayTarget.content;
    const assessment = assessLength(before, essayTarget, essays);
    if (assessment.ok) {
      toast.success('This draft is already inside its target band', { description: assessment.message });
      setLengthIssue(null);
      return;
    }
    const ui = scopedSetters(essayTarget.id);
    const priorReview = reviewResult;
    return runEssayTask(essayTarget, { stage: 'repair', label: 'Finishing the length' }, async () => {
    try {
      const essayForAction = await prepareEssayRoot(essayTarget);
      const context = await gatherContext(essayForAction, 'length');
      const fix = await repairLength({ essay: essayForAction, context, text: before, assessment, mode: 'fix' });
      if (!fix) {
        toast.error('The model could not bring this to length', {
          description: 'Its second answer was not closer to the target band, so Atlas changed nothing. Try again, or add the missing detail yourself.',
          duration: 10000,
        });
        return;
      }
      const { ops } = diffText(before, fix.text);
      const stats = diffStats(ops);
      setEssaySnapshot(essayForAction.id, { content: before, label: 'before the length fix', review: priorReview });
      ui.setSnapshot(getEssaySnapshot(essayForAction.id));
      rememberForUndo(essayForAction, { content: before, status: essayForAction.status }, 'length fixed');
      await persist({ content: fix.text, status: essayForAction.status === 'not_started' ? 'drafting' : essayForAction.status }, essayForAction);
      ui.setRevision({
        before, after: fix.text, ops, stats, unit: fix.assessment.unit,
        changes: [], why: fix.notes || '', gaps: fix.gaps || [], at: new Date().toISOString(),
      });
      ui.setLengthIssue(fix.assessment.ok ? null : fix.assessment);
      recordProgress(essayForAction.id, {
        action: 'repair',
        unit: fix.assessment.unit,
        wordsBefore: assessment.count,
        wordsAfter: fix.assessment.count,
        scoreBefore: priorReview?.overall_score ?? null,
        scoreAfter: null,
        note: 'length fixed',
      });
      toast.success(`Now ${fix.assessment.count.toLocaleString()} ${formatLimit(fix.assessment.unit)}`, {
        description: fix.assessment.message,
      });
    } catch (e) {
      console.error(e);
    }
    });
  };

  /** Puts the applicant's own pre-edit text back, and the review that went with it. */
  const handleRestoreSnapshot = async () => {
    const current = currentSelectedEssay();
    if (!current || !snapshot?.content || busy !== null || saving || rootSaving) return;
    if (!window.confirm('Put your own version back? The AI revision will be replaced in the editor.')) return;
    const target = { ...current };
    const replaced = target.content || '';
    const restored = snapshot.content;
    const restoredReview = snapshot.review || null;
    const ui = scopedSetters(target.id);
    return runEssayTask(target, { stage: 'restore', label: 'Restoring your version' }, async () => {
    try {
      rememberForUndo(target, { content: replaced, status: target.status }, 'AI revision re-applied');
      await persist({ content: restored, status: 'polishing' }, target);
      const assessment = assessLength(restored, target, essays);
      if (restoredReview) {
        const measured = withMeasuredLength(restoredReview, { ...target, content: restored }, essays);
        ui.setReviewResult(measured);
        setCachedEssayReview(target.id, measured);
        ui.setPreviousScore(null);
      }
      clearEssaySnapshot(target.id);
      ui.setSnapshot(null);
      ui.setRevision(null);
      ui.setLengthIssue(assessment.ok ? null : assessment);
      recordProgress(target.id, {
        action: 'restore',
        unit: assessment.unit,
        wordsBefore: assessLength(replaced, target, essays).count,
        wordsAfter: assessment.count,
        scoreBefore: reviewResult?.overall_score ?? null,
        scoreAfter: restoredReview?.overall_score ?? null,
        note: 'your own version put back',
      });
      toast.success('Your version is back in the editor');
    } catch (e) {
      toast.error('Could not restore that version', { description: e.message });
    }
    });
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
    if (saving || rootSaving) return;
    if (taskForEssay(essay.id)) {
      toast.message('This essay is still being worked on', { description: 'Wait for the running AI step to finish before deleting it.' });
      return;
    }
    if (!window.confirm(`Delete "${essay.title}"? This cannot be undone.`)) return;
    try {
      await essayWriteRef.current.catch(() => undefined);
      await base44.entities.Essay.delete(essay.id);
      setEssays((prev) => prev.filter((e) => e.id !== essay.id));
      // Nothing cached for a deleted essay should outlive it in this browser.
      clearEssaySnapshot(essay.id);
      clearEssayProgress(essay.id);
      clearCachedEssayReview(essay.id);
      clearCachedEssayGen(essay.id);
      clearLocalDraftAnchor(essay.id);
      clearLocalEditInstructions(essay.id);
      essayRevisions.delete(String(essay.id));
      if (selectedEssay?.id === essay.id) {
        selectedEssayRef.current = null;
        setSelectedEssay(null);
        updateDirtyFields([]);
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
    if (saving || rootSaving) throw new Error('Wait for the current save to finish before creating another essay.');
    if (dirty && selectedEssay) {
      const saved = await handleSave();
      if (!saved) throw new Error('The current essay was not confirmed as saved, so no new essay was created. Your changes remain in the editor.');
    }
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
      if (!row) {
        await loadEssays().catch(() => []);
        throw new Error('Atlas could not confirm whether this essay was created. Check the list before retrying to avoid a duplicate; the form is still open.');
      }
      const missing = base44.capabilities?.missingOptionalColumns?.() || [];
      if (Object.prototype.hasOwnProperty.call(row, 'draft_anchor') && !missing.includes('draft_anchor')) {
        clearLocalDraftAnchor(row.id);
      } else {
        rememberDraftAnchor(row.id, d.draft_anchor || '');
      }
      created.push(hydrateEssay(row));
    }
    await loadEssays();
    if (created[0]) {
      selectedEssayRef.current = created[0];
      setSelectedEssay(created[0]);
    }
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
          disabled={saving || rootSaving}
          className={`w-full text-left p-3 rounded-xl border transition-all pr-8 ${
            selectedEssay?.id === essay.id
              ? 'border-foreground/20 bg-card shadow-sm'
              : 'border-border bg-card/50 hover:bg-card hover:border-foreground/10'
          }`}
        >
          <div className="flex items-center gap-2 mb-1">
            {runningEssayIds.has(String(essay.id))
              ? <span title="AI is working on this essay" className="shrink-0 inline-flex"><Loader2 className="w-3.5 h-3.5 text-accent animate-spin" /></span>
              : essay.status === 'final' || essay.status === 'polishing'
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
          disabled={runningEssayIds.has(String(essay.id)) || saving || rootSaving}
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
          <Select value={selectedUni?.id} onValueChange={handleSelectUni} disabled={rootSaving || saving}>
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
                  <fieldset disabled={busy !== null || saving || rootSaving} className="px-5 pb-5 space-y-3 border-t border-border pt-4">
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
                  </fieldset>
                )}
              </div>

              <div className="bg-accent/5 border border-accent/20 rounded-xl p-4 space-y-2">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div>
                    <label htmlFor="essay-root" className="text-sm font-medium text-foreground/70">What must this essay be rooted in?</label>
                    <p className="text-[11px] text-accent/80 mt-0.5">Your direction is a hard constraint and the starting point for future drafts.</p>
                  </div>
                  <Button onClick={handleSaveRoot} variant="outline" size="sm" disabled={rootSaving || saving || busy !== null}>
                    {rootSaving ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Save className="w-3.5 h-3.5 mr-1.5" />}
                    {rootSaving ? 'Saving root…' : 'Save root'}
                  </Button>
                </div>
                <Textarea
                  id="essay-root"
                  value={selectedEssay.draft_anchor || ''}
                  disabled={rootSaving || saving || busy !== null}
                  onChange={(e) => handleFieldChange('draft_anchor', e.target.value)}
                  placeholder="Add the moments, interests, questions, relationships, or qualities you want the draft to grow from."
                  rows={4}
                  className="bg-background/70"
                />
                {rootReading.hasRoot && (
                  <p className="text-[11px] text-foreground/45 flex items-start gap-1.5 leading-relaxed">
                    <Compass className="w-3.5 h-3.5 mt-px shrink-0 text-accent-foreground/70" />
                    <span>
                      {rootReading.chooseOne
                        ? `Atlas reads this as “choose one”: ${rootReading.alternatives.length || 'several'} possible subjects, and the draft must build on ONE of them`
                        : rootReading.includeAll
                          ? `Atlas reads this as “cover them all”: ${rootReading.alternatives.length || 'the listed'} subjects are each a requirement`
                          : rootReading.alternatives.length >= 2
                            ? `Atlas found ${rootReading.alternatives.length} subjects with no instruction to choose, so it will build on one and hold the draft to that`
                            : 'Atlas reads one direction, with no list of alternatives inside it'}
                      {rootReading.constraints.length
                        ? `, plus ${rootReading.constraints.length} stated rule${rootReading.constraints.length === 1 ? '' : 's'} it must not break` : ''}.
                      {rootReading.alternatives.length >= 2 && !rootReading.chooseOne && !rootReading.includeAll
                        ? ' Say “pick the strongest one” or “include all of them” if you want the other reading.' : ''}
                      {' '}Every draft is checked against this before it is shown to you.
                    </span>
                  </p>
                )}
                <p className="text-[11px] text-foreground/45 leading-relaxed">
                  Atlas will use the profile, materials, guidance, and sample craft to deepen this direction. It must not replace your roots with a random activity; if something is missing, it will leave a gap for you.
                </p>
                {missingEssayColumns.includes('draft_anchor') && (
                  <p className="text-[11px] text-amber-700 leading-relaxed">
                    Your database is missing the root field. Atlas is keeping this direction in this browser for now; run <span className="font-mono">supabase/schema.sql</span> to persist it across devices.
                  </p>
                )}
              </div>

              <div className="bg-card border border-border rounded-xl p-4 space-y-2">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div>
                    <label htmlFor="essay-edit-instructions" className="text-sm font-medium text-foreground/70 inline-flex items-center gap-1.5">
                      <ListChecks className="w-4 h-4 text-accent" />
                      Edit instructions — exactly what to change
                    </label>
                    <p className="text-[11px] text-foreground/50 mt-0.5">
                      One instruction per sentence or line. “Apply edits” and “Generate draft” carry out every one of them, above anything the review suggests; the root above still outranks these.
                    </p>
                  </div>
                  {splitEditInstructions(selectedEssay.edit_instructions).length > 0 && (
                    <Badge variant="outline" className="h-5 px-1.5 text-[10px] shrink-0">
                      {splitEditInstructions(selectedEssay.edit_instructions).length} instruction{splitEditInstructions(selectedEssay.edit_instructions).length === 1 ? '' : 's'}
                    </Badge>
                  )}
                </div>
                <Textarea
                  id="essay-edit-instructions"
                  value={selectedEssay.edit_instructions || ''}
                  disabled={rootSaving || saving || busy !== null}
                  onChange={(e) => handleFieldChange('edit_instructions', e.target.value)}
                  placeholder={'e.g. Cut the second paragraph about the robotics club.\nReplace "I was passionate" with what I actually did that night.\nKeep the last line exactly as it is.'}
                  rows={3}
                />
                <p className="text-[11px] text-foreground/45 leading-relaxed">
                  Quote the words you mean (“cut ‘in the end’”, “keep ‘the clinic door’”) and Atlas checks the result against the text itself, not the editor&apos;s word. Saved with the essay; clear it when the changes are done.
                </p>
                {missingEssayColumns.includes('edit_instructions') && (
                  <p className="text-[11px] text-amber-700 leading-relaxed">
                    Your database is missing the edit_instructions field. Atlas is keeping these in this browser for now; run <span className="font-mono">supabase/schema.sql</span> to persist them across devices.
                  </p>
                )}
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                <Button onClick={handleGenerate} disabled={busy !== null || saving || rootSaving}>
                  {busy === 'generate' ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Wand2 className="w-4 h-4 mr-2" />}
                  {busy === 'generate' ? 'Writing…' : 'Generate draft'}
                </Button>
                <Button onClick={handleReview} disabled={busy !== null || saving || rootSaving || !selectedEssay.content} variant="outline">
                  {busy === 'review' ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <ClipboardCheck className="w-4 h-4 mr-2" />}
                  {busy === 'review' ? 'Reviewing…' : 'Admissions review'}
                </Button>
                <Button onClick={handlePolish} disabled={busy !== null || saving || rootSaving || !selectedEssay.content} variant="outline">
                  {editing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Sparkles className="w-4 h-4 mr-2" />}
                  {busy === 'polish' ? 'Editing…'
                    : busy === 'repair' ? 'Finishing the length…'
                      : busy === 're_review' ? 'Re-scoring…'
                        : 'Apply edits'}
                </Button>
                {lengthState?.needsWork && (
                  <Button
                    onClick={handleFixLength}
                    disabled={busy !== null || saving || rootSaving}
                    variant="outline"
                    className="border-amber-300 text-amber-800 hover:bg-amber-50 hover:text-amber-900"
                  >
                    {busy === 'repair' ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Ruler className="w-4 h-4 mr-2" />}
                    {lengthState.state === 'over' ? 'Trim to the limit' : 'Finish the length'}
                  </Button>
                )}
                <div className="flex items-center gap-2 ml-auto">
                  {dirty && <span className="text-[11px] text-foreground/35">Unsaved — autosaving…</span>}
                  <Button onClick={handleSave} disabled={saving || rootSaving || !dirty} variant="ghost" size="sm">
                    <Save className="w-4 h-4 mr-1.5" />
                    {saving ? 'Saving…' : 'Save'}
                  </Button>
                  <Button onClick={() => handleDeleteEssay(selectedEssay)} disabled={busy !== null || saving || rootSaving} variant="ghost" size="sm" className="text-destructive hover:text-destructive">
                    <Trash2 className="w-4 h-4 mr-1.5" /> Delete
                  </Button>
                </div>
              </div>

              {essayTask && (
                <div className="flex items-start gap-2.5 p-3 rounded-xl bg-accent/5 border border-accent/20 text-xs text-foreground/65 leading-relaxed">
                  <Loader2 className="w-4 h-4 text-accent shrink-0 mt-0.5 animate-spin" />
                  <p>
                    <span className="font-medium text-foreground/80">{essayTask.label}</span> — this runs in the background.
                    You can switch to another essay, open another page, or keep working elsewhere; the result is saved to this essay when it finishes, and the sidebar shows the progress.
                  </p>
                </div>
              )}

              <div className="flex items-center gap-4 flex-wrap text-xs">
                <label className="inline-flex items-center gap-2 cursor-pointer select-none">
                  <Switch
                    checked={autoReview}
                    onCheckedChange={(value) => { setAutoReview(value); setAutoReviewAfterEdit(value); }}
                    disabled={busy !== null || saving || rootSaving}
                  />
                  <span className="text-foreground/55">Re-score automatically after an edit</span>
                </label>
                <label className="inline-flex items-center gap-2 cursor-pointer select-none" title="An edit that re-scores lower is never an improvement. With this on, your previous text is put back by itself and the rejected edit is kept as the comparison.">
                  <Switch
                    checked={autoRestoreWorse}
                    onCheckedChange={(value) => { setAutoRestoreWorse(value); setAutoRestoreWorseEdit(value); }}
                    disabled={!autoReview || busy !== null || saving || rootSaving}
                  />
                  <span className="text-foreground/55">Put my version back if the edit scores lower</span>
                </label>
                <span className="text-foreground/30 hidden sm:inline">
                  An edit counts as an improvement only when the same rubric scores it higher.
                </span>
                {snapshot?.content && snapshot.content !== (selectedEssay.content || '') && !revision && (
                  <div className="flex items-center gap-3 ml-auto">
                    <button onClick={showSnapshotDiff} className="inline-flex items-center gap-1.5 text-accent hover:underline">
                      <FileDiff className="w-3.5 h-3.5" />
                      Compare with {snapshot.label || 'the previous version'}
                    </button>
                    <button onClick={handleRestoreSnapshot} disabled={busy !== null || saving || rootSaving} className="inline-flex items-center gap-1.5 text-foreground/45 hover:text-foreground hover:underline">
                      <RotateCcw className="w-3.5 h-3.5" />
                      Restore it
                    </button>
                  </div>
                )}
              </div>
              {(undoStep?.essayId === selectedEssay.id || actionHintFor(selectedEssay)) && (
                <div className="flex items-center gap-3 flex-wrap text-xs">
                  {undoStep?.essayId === selectedEssay.id && (
                    <button onClick={undoLastChange} disabled={busy !== null || saving || rootSaving} className="inline-flex items-center gap-1.5 text-accent hover:underline">
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
                    disabled={busy !== null || saving || rootSaving}
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
                  disabled={busy !== null || saving || rootSaving}
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
                        disabled={busy !== null || saving || rootSaving}
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
                  disabled={busy !== null}
                  onKeep={() => setRevision(null)}
                  onFixRemaining={(revision?.unaddressed?.length || revision?.instructionCheck?.missed) ? handleFinishFlagged : null}
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
