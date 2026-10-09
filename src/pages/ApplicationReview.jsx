import { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { toast } from 'sonner';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  ArrowLeft, Loader2, ClipboardCheck, AlertTriangle, Globe,
  GraduationCap, Briefcase, Award, FileText, BookOpen, ScrollText,
  Library, CheckCircle2, Circle,
} from 'lucide-react';
import {
  essaysApplicableToUniversity, getUniversityPlatform, PLATFORMS, PLATFORM_LABELS,
  PLATFORM_REQUIREMENTS, isSharedEssay, limitUnitFor, measureEssay,
  findKnowledgeRecord, isUcasQuestion, ucasCharacterBudget,
} from '@/lib/essayScope';
import { buildProfileContext, ibSubjectLines } from '@/lib/profileContext';
import { formatMaterialsForAI, presentMaterial, isSampleMaterial } from '@/lib/materialRole';
import { runAI } from '@/lib/ai';
import { hasLiveModel, isLiveOutcome } from '@/lib/aiOutcome';
import { loadApplicantKnowledgeText } from '@/lib/applicantKnowledgeService';
import { startOfLocalDay } from '@/lib/dates';
import { APPLICATION_REVIEW_SCHEMA, APPLICATION_REVIEW_DIMENSIONS } from '@/lib/essayPrompts';
import ReviewResults from '@/components/review/ReviewResults';
import { getCachedReview, setCachedReview, clearCachedReview } from '@/lib/persist';

/** Short state of one material, as the review will see it. */
function materialReadState(m) {
  if (m.document_state === 'none') return 'context only';
  if (m.document_state !== 'ready') return 'not read yet';
  return m.analysis?.status === 'ready' ? 'analyzed' : 'read, not analyzed';
}

function formatEssays(essays) {
  if (!essays || essays.length === 0) return 'NO ESSAYS EXIST FOR THIS UNIVERSITY. Treat this as a material weakness and say so.';
  const budget = ucasCharacterBudget(essays);
  const ucasNote = essays.some(isUcasQuestion)
    ? `UCAS CHARACTER BUDGET: these answers SHARE ${budget.limit.toLocaleString()} characters including spaces (currently ${budget.total.toLocaleString()}). Do not treat each answer as having 4,000 characters of its own. Minimum 350 each. Never name a university in these answers.

`
    : '';
  return ucasNote + essays
    .map((e) => {
      const scope = e.scope === 'common'
        ? `SHARED across the whole ${PLATFORM_LABELS[e.application_platform] || e.application_platform} — sent identically to every school on that platform`
        : 'Written only for this university';
      const u = limitUnitFor(e);
      const n = measureEssay(e.content || '', u);
      const lim = Number(e.word_limit) || 0;
      const body = e.content || '[NOT WRITTEN — this is a gap in the application]';
      return `--- ${e.title} ---
Scope: ${scope}
Type: ${e.type} | Status: ${(e.status || 'not_started').replace(/_/g, ' ')} | Length: ${n}/${lim} ${u}
Prompt: ${e.prompt || '(none supplied)'}
${body}`;
    })
    .join('\n\n');
}

/**
 * What each holistic dimension is actually asking. Keyed by the dimension
 * names in APPLICATION_REVIEW_DIMENSIONS, which are also the exact `name`
 * values the JSON schema accepts — so the prompt and the response contract
 * cannot drift apart.
 */
const DIMENSION_GUIDANCE = {
  'Academic Excellence': 'rigor and results against the published admitted profile. Where is this applicant: below the 25th, 50th, or 75th percentile of the admitted class?',
  'Extracurricular Distinction': 'depth, leadership, and measurable impact. Participation is not distinction. Would an officer remember this list in March?',
  'Essay Quality': 'does the writing do the job its prompt requires, and do the essays work as a set rather than repeating each other?',
  'Personal Character': 'what kind of person emerges, and is that who this school wants?',
  'Institutional Fit': `against this specific school's stated mission and values, not a generic notion of fit.`,
  'Contextual Factors': 'nationality, curriculum, aid status, and anything that helps or hurts a realistic case.',
  'Overall Cohesion': 'do the pieces tell one coherent story, or read as separate parts?',
};

export default function ApplicationReview() {
  const { id } = useParams();
  const [university, setUniversity] = useState(null);
  const [notFound, setNotFound] = useState(false);
  const [profile, setProfile] = useState(null);
  const [essays, setEssays] = useState([]);
  const [materials, setMaterials] = useState([]);
  const [applicantRows, setApplicantRows] = useState([]);
  const [knowledge, setKnowledge] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [reviewing, setReviewing] = useState(false);
  const [reviewResult, setReviewResult] = useState(null);
  const [cachedAt, setCachedAt] = useState(null);

  const loadData = useCallback(async () => {
    try {
      const uni = await base44.entities.University.get(id);
      if (!uni) { setNotFound(true); return; }
      setUniversity(uni);

      const [profiles, allEssays, mats, knw, tks] = await Promise.all([
        base44.entities.Profile.list(),
        base44.entities.Essay.list(),
        base44.entities.Material.list(),
        base44.entities.CollegeKnowledge.list(),
        base44.entities.RoadmapTask.filter({ university_id: id }),
      ]);

      // The AI knowledge base is optional: a missing table just means "not built yet".
      const applicantRows = await base44.entities.ApplicantKnowledge.list().catch(() => []);
      setProfile(profiles[0] || null);
      setEssays(essaysApplicableToUniversity(allEssays, uni));
      // Raw rows: the review formats them itself, so they are not presented twice.
      setMaterials(mats);
      setApplicantRows(applicantRows);
      setKnowledge(
        findKnowledgeRecord(knw, uni.name),
      );
      setTasks(tks);

      // Restore cached review if any — this keeps the result on screen even after navigating away
      const cached = getCachedReview(id);
      if (cached?.result) {
        setReviewResult(cached.result);
        setCachedAt(cached.savedAt || null);
      }
    } catch (e) {
      console.error(e);
      toast.error('Could not load this application', { description: e.message });
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { loadData(); }, [loadData]);

  const runReview = async () => {
    if (!hasLiveModel()) {
      toast.error('The full review needs a connected AI model', {
        description: 'Demo mode shows placeholder text, so nothing was reviewed or saved. Connect a local model in AI setup (AI status in the sidebar).',
        duration: 9000,
      });
      return;
    }
    setReviewing(true);
    setReviewResult(null);
    try {
      const p = profile || {};
      const platform = getUniversityPlatform(university);
      const knowledgeText = knowledge?.knowledge
        || 'No university research is cached for this university. Use your own knowledge, and say explicitly where you are estimating.';
      const applicantText = await loadApplicantKnowledgeText({ platform });
      const completedTasks = tasks.filter((t) => t.completed).length;
      const profileText = buildProfileContext(p, { includeLeadershipBrief: true }) || 'No profile data saved.';
      const ibLines = ibSubjectLines(p);

      const dimensionList = APPLICATION_REVIEW_DIMENSIONS
        .map((name, i) => `${i + 1}. ${name} — ${DIMENSION_GUIDANCE[name]}`)
        .join('\n');

      const prompt = `You are the senior admissions officer reading this file at ${university.name}. You are the gatekeeper, not the applicant's advocate.

HOW TO JUDGE:
- Most applicants to ${university.name} are qualified and still rejected. "Good" is not the same as admitted.
- 5/10 means average for this pool. 7/10 is genuinely competitive. 9/10 is exceptional and rare.
- Judge against the published admitted-student profile, not against a generic idea of a good student.
- A missing or unwritten essay is a material weakness, not a neutral gap. Score it as one.
- Read the applicant's context properly. This student is applying internationally through ${PLATFORMS[platform]?.label}. Where their education system, curriculum, or nationality differs from the US/UK norm, that is context to be read intelligently — not a weakness — but an unexplained difference is still a weakness.
- Do not inflate anything. If the evidence is not in the file, it is not in the file.

RESEARCH AND IDEAL STUDENT PROFILE (from University Research):
${knowledgeText}
${applicantText ? `
WHAT ATLAS KNOWS ABOUT THIS APPLICANT (AI knowledge base; AI-built and applicant-edited. Judge the file against it. It never adds to the file):
${applicantText}
` : ''}
HOW THIS UNIVERSITY'S WRITING WORKS:
${PLATFORM_REQUIREMENTS[platform]?.summary || ''}
${PLATFORMS[platform]?.sharedNote || ''}

THE COMPLETE APPLICATION:

--- PERSONAL AND ACADEMIC BACKGROUND ---
${profileText}
${ibLines.length ? `\nIB subject workload (${ibLines.length} subjects):\n${ibLines.join('\n')}\nTreat Higher Level subject choice as evidence of academic ambition, and note where the workload is lighter than a US applicant would expect.` : ''}

--- ESSAYS ---
${formatEssays(essays)}

--- SUPPORTING MATERIALS (own = facts about student, use heavily; samples = craft only, never borrow life; distinguish US vs UK) ---
${formatMaterialsForAI(materials, { platform })}

--- READINESS ---
- Roadmap tasks completed: ${completedTasks}/${tasks.length}
- Application status: ${university.status}
${university.deadline ? `- Deadline: ${university.deadline}` : '- No deadline set'}
- Research available: ${knowledge ? 'yes' : 'NO — you are judging without institutional data, and must flag that'}

MATERIALS USAGE RULES:
- Personal materials (resume, own essays, notes) are evidence — use their concrete details as much as possible when assessing authenticity and specificity.
- Sample essays (successful essays from others) must be treated as craft examples only. Never treat a sample's biography as this applicant's life. Distinguish US Common App/UC samples from UK UCAS samples — do not apply UK structure to US evaluation or vice versa. If a UK sample is present, do not penalize the US application for not following UK conventions, and vice versa.
- If materials have been analyzed word-by-word, use those analyses to inform your assessment of voice, specificity, and authenticity.

SCORE EACH OF THESE DIMENSIONS 1-10, WITH A SPECIFIC ASSESSMENT (use exactly these names, in this order):
${dimensionList}

RETURN FORMAT — use exactly these field names:
- "acceptance_probability": your single best estimate as a number 0-100.
- "verdict": one of "Hard Reach", "Reach", "Target", "Likely", "Safety".
- "dimensions": one entry per dimension above, in that order, each { "name", "score" (1-10), "assessment" }.
- "key_strengths", "key_weaknesses", "what_would_help", "gaps": arrays of short, concrete sentences. No vague advice — each item must name something the applicant can actually do or check.
- "summary": three or four sentences of overall assessment, in the voice of a reader who has just finished the file.

Return JSON only.`;
      const outcome = await runAI(
        { prompt, response_json_schema: APPLICATION_REVIEW_SCHEMA },
        { fallbackTitle: 'The review could not be completed' },
      );
      if (!isLiveOutcome(outcome)) return;
      const result = outcome.result;
      setReviewResult(result);
      setCachedReview(id, result);
      setCachedAt(new Date().toISOString());
      toast.success('Review complete', {
        description: `${result.verdict} · ${Math.round(result.acceptance_probability || 0)}% estimated acceptance. Saved so it stays when you navigate away.`,
      });
    } finally {
      setReviewing(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32">
        <div className="w-8 h-8 border-2 border-border border-t-foreground rounded-full animate-spin" />
      </div>
    );
  }

  if (notFound || !university) {
    return (
      <div className="text-center py-32">
        <p className="text-foreground/50 mb-4">University not found.</p>
        <Link to="/universities"><Button variant="outline">Back to Universities</Button></Link>
      </div>
    );
  }

  const p = profile || {};
  const platform = getUniversityPlatform(university);
  const completedTasks = tasks.filter((t) => t.completed).length;
  const shownMaterials = materials.map(presentMaterial);
  const unreadMaterials = shownMaterials.filter((m) => m.document_state !== 'none'
    && (m.document_state !== 'ready' || m.analysis?.status !== 'ready')).length;
  const applicantKnown = applicantRows.some((r) => String(r.text || '').trim());
  const modelReady = hasLiveModel();
  const sharedCount = essays.filter(isSharedEssay).length;
  const unwritten = essays.filter((e) => !e.content || !e.content.trim()).length;
  const sharedMissing = !essays.some(isSharedEssay) && PLATFORMS[platform]?.sharedEssays;

  return (
    <div className="space-y-6">
      <Link to={`/universities/${id}`} className="inline-flex items-center gap-1.5 text-sm text-foreground/40 hover:text-foreground transition">
        <ArrowLeft className="w-4 h-4" />
        Back to {university.name}
      </Link>

      <div>
        <h1 className="font-display text-3xl font-semibold tracking-tight">Application Review</h1>
        <div className="flex items-center gap-2 mt-1.5 flex-wrap">
          <p className="text-foreground/50">{university.name}</p>
          <Badge variant="outline" className="gap-1">
            <Globe className="w-2.5 h-2.5" />{PLATFORMS[platform]?.label}
          </Badge>
        </div>
      </div>

      <div className="flex items-start gap-3 p-4 rounded-xl bg-amber-50 border border-amber-200">
        <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-medium text-amber-800">Strict, neutral evaluation</p>
          <p className="text-sm text-amber-700/80 mt-0.5">
            The AI is instructed to be brutally honest — not on your side. Acceptance percentages are estimates
            against this school&apos;s selectivity and your actual file. Most qualified applicants are still rejected.
          </p>
        </div>
      </div>

      {/* Blocking gaps the user can fix right now */}
      {(sharedMissing || unwritten > 0 || !knowledge || !profile || unreadMaterials > 0 || !applicantKnown || !modelReady) && (
        <div className="bg-card border border-border rounded-xl p-5 space-y-2.5">
          <h3 className="text-sm font-medium">Before you trust this review</h3>
          <ul className="space-y-1.5">
            {!profile && (
              <li className="text-sm text-foreground/60 flex gap-2">
                <Circle className="w-3.5 h-3.5 text-red-500 shrink-0 mt-0.5" />
                No profile saved — the AI has nothing to judge. <Link to="/profile" className="text-accent hover:underline">Fill in your profile</Link>
              </li>
            )}
            {sharedMissing && (
              <li className="text-sm text-foreground/60 flex gap-2">
                <Circle className="w-3.5 h-3.5 text-red-500 shrink-0 mt-0.5" />
                The shared {PLATFORMS[platform]?.short} writing is missing, so this school sees a hole where every other school sees your essay. <Link to={`/essay-builder?university=${id}`} className="text-accent hover:underline">Create it</Link>
              </li>
            )}
            {unwritten > 0 && (
              <li className="text-sm text-foreground/60 flex gap-2">
                <Circle className="w-3.5 h-3.5 text-amber-500 shrink-0 mt-0.5" />
                {unwritten} of {essays.length} essays {unwritten === 1 ? 'is' : 'are'} still blank. A missing essay is scored as a weakness.
              </li>
            )}
            {!knowledge && (
              <li className="text-sm text-foreground/60 flex gap-2">
                <Circle className="w-3.5 h-3.5 text-amber-500 shrink-0 mt-0.5" />
                No university research for this school — the review is running without institutional data. <Link to="/knowledge-base" className="text-accent hover:underline">Research it</Link>
              </li>
            )}
            {unreadMaterials > 0 && (
              <li className="text-sm text-foreground/60 flex gap-2">
                <Circle className="w-3.5 h-3.5 text-amber-500 shrink-0 mt-0.5" />
                {unreadMaterials} {unreadMaterials === 1 ? 'material is' : 'materials are'} not read or analyzed yet. The review only sees what Atlas has read. <Link to="/materials" className="text-accent hover:underline">Check materials</Link>
              </li>
            )}
            {!applicantKnown && (
              <li className="text-sm text-foreground/60 flex gap-2">
                <Circle className="w-3.5 h-3.5 text-amber-500 shrink-0 mt-0.5" />
                Atlas has not built its knowledge of you yet, so the review cannot use it. <Link to="/ai-knowledge" className="text-accent hover:underline">Build the AI knowledge base</Link>
              </li>
            )}
            {!modelReady && (
              <li className="text-sm text-foreground/60 flex gap-2">
                <Circle className="w-3.5 h-3.5 text-red-500 shrink-0 mt-0.5" />
                No AI model is connected (demo mode). Connect a local model in AI setup, from the AI status in the sidebar, to run the review.
              </li>
            )}
          </ul>
        </div>
      )}

      <div className="space-y-4">
        <h2 className="font-display text-xl font-semibold">Application Preview</h2>
        <p className="text-sm text-foreground/40 -mt-2">Everything that would be sent to {university.name}</p>

        <div className="grid md:grid-cols-2 gap-4">
          <div className="bg-card border border-border rounded-xl p-5">
            <h3 className="flex items-center gap-2 text-sm font-medium mb-3"><Globe className="w-4 h-4 text-foreground/40" /> Personal Background</h3>
            <dl className="space-y-1.5 text-sm">
              <Row label="Name" value={p.full_name} />
              <Row label="Nationality" value={p.nationality} />
              <Row label="Citizenship" value={p.citizenship_status} />
              <Row label="School system" value={p.school_system} />
              <Row label="Curriculum" value={p.curriculum} />
              <Row label="Graduation" value={p.graduation_year} />
              <Row label="First-generation" value={p.first_generation} />
              <Row label="Financial aid" value={p.requires_financial_aid ? 'Yes' : 'No (full-pay)'} />
            </dl>
            {p.background_summary && <p className="text-xs text-foreground/50 mt-3 pt-3 border-t border-border line-clamp-3">{p.background_summary}</p>}
          </div>

          <div className="bg-card border border-border rounded-xl p-5">
            <h3 className="flex items-center gap-2 text-sm font-medium mb-3"><GraduationCap className="w-4 h-4 text-foreground/40" /> Academic Record</h3>
            <dl className="space-y-1.5 text-sm">
              <Row label="IB predicted" value={p.ib_predicted_score ? `${p.ib_predicted_score}/45` : null} />
              <Row label="GPA" value={p.gpa_value ? `${p.gpa_value}${p.gpa_scale ? ` / ${p.gpa_scale}` : ''}` : null} />
              <Row label="Class rank" value={p.rank} />
              <Row label="SAT" value={p.sat_math || p.sat_ebrw ? `${(Number(p.sat_math) || 0) + (Number(p.sat_ebrw) || 0)}/1600` : null} />
              <Row label="ACT" value={p.act_score} />
              <Row label="IELTS" value={p.ielts_listening ? `L${p.ielts_listening} R${p.ielts_reading} W${p.ielts_writing} S${p.ielts_speaking}` : null} />
              <Row label="TOEFL" value={p.toefl_total} />
            </dl>
            {ibSubjectLines(p).length > 0 && (
              <div className="text-xs text-foreground/50 mt-3 pt-3 border-t border-border">
                {ibSubjectLines(p).length} IB subjects
                <span className="block text-[11px] text-foreground/35 mt-0.5">
                  {ibSubjectLines(p).map((line, i) => <span key={i} className="block">{line}</span>)}
                </span>
              </div>
            )}
          </div>
        </div>

        <div className="bg-card border border-border rounded-xl p-5">
          <h3 className="flex items-center gap-2 text-sm font-medium mb-3"><Briefcase className="w-4 h-4 text-foreground/40" /> Activities ({(p.activities || []).length}/10)</h3>
          {(p.activities || []).length > 0 ? (
            <div className="space-y-2">
              {p.activities.map((a, i) => (
                <div key={i} className="flex items-start gap-3 text-sm py-2 border-b border-border last:border-0">
                  <span className="text-foreground/30 font-mono text-xs mt-0.5">{i + 1}</span>
                  <div className="flex-1">
                    <span className="font-medium">{a.position || '—'}</span>
                    {a.organization && <span className="text-foreground/50">, {a.organization}</span>}
                    {a.activity_type && <span className="text-foreground/30 text-xs ml-2">{a.activity_type}</span>}
                    {a.description && <p className="text-xs text-foreground/50 mt-0.5">{a.description}</p>}
                    <p className="text-xs text-foreground/30 mt-0.5">
                      {(a.grade_levels || []).join(', ')} · {a.timing || ''} · {a.hours_per_week ?? '?'}h/wk · {a.weeks_per_year ?? '?'}wk/yr
                    </p>
                  </div>
                </div>
              ))}
            </div>
          ) : p.activities_awards ? (
            <p className="text-sm text-foreground/50">{p.activities_awards}</p>
          ) : (
            <p className="text-sm text-foreground/30">No activities listed. This is a significant weakness at every selective school.</p>
          )}
        </div>

        <div className="bg-card border border-border rounded-xl p-5">
          <h3 className="flex items-center gap-2 text-sm font-medium mb-3"><Award className="w-4 h-4 text-foreground/40" /> Honors ({(p.honors || []).length}/5)</h3>
          {(p.honors || []).length > 0 ? (
            <div className="space-y-1.5">
              {p.honors.map((h, i) => (
                <div key={i} className="flex items-center gap-3 text-sm">
                  <span className="text-foreground/30 font-mono text-xs">{i + 1}</span>
                  <span className="font-medium">{h.name || '—'}</span>
                  <span className="text-foreground/40 text-xs">Grade {h.grade_level || '?'}</span>
                  <span className="text-xs text-accent">{h.level || ''}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-foreground/30">No honors listed.</p>
          )}
        </div>

        <div className="bg-card border border-border rounded-xl p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="flex items-center gap-2 text-sm font-medium">
              <ScrollText className="w-4 h-4 text-foreground/40" /> Essays ({essays.length})
            </h3>
            {sharedCount > 0 && (
              <Badge variant="outline" className="gap-1 text-[10px]">
                <Library className="w-2.5 h-2.5" />{sharedCount} shared
              </Badge>
            )}
          </div>
          {essays.some(isUcasQuestion) && (
            <p className={`text-xs mb-2 ${ucasCharacterBudget(essays).over ? 'text-destructive' : 'text-foreground/40'}`}>
              The three UCAS answers share {ucasCharacterBudget(essays).total.toLocaleString()} / {ucasCharacterBudget(essays).limit.toLocaleString()} characters, including spaces.
            </p>
          )}
          {essays.length > 0 ? (
            <div className="space-y-2">
              {essays.map((e) => {
                const u = limitUnitFor(e);
                const n = measureEssay(e.content || '', u);
                const lim = Number(e.word_limit) || 0;
                const ucasRow = isUcasQuestion(e);
                const blank = !e.content || !e.content.trim();
                return (
                  <div key={e.id} className="flex items-center justify-between gap-3 text-sm py-1.5 border-b border-border last:border-0">
                    <div className="flex items-center gap-2 min-w-0">
                      {blank
                        ? <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                        : <CheckCircle2 className="w-3.5 h-3.5 text-green-500 shrink-0" />}
                      <span className="font-medium truncate">{e.title}</span>
                      {isSharedEssay(e) && <span className="text-[10px] text-accent shrink-0">shared</span>}
                    </div>
                    <div className="flex items-center gap-2 text-xs text-foreground/40 shrink-0">
                      <span className="capitalize">{(e.status || 'not_started').replace(/_/g, ' ')}</span>
                      <span>·</span>
                      <span className={(ucasRow ? ucasCharacterBudget(essays).over : n > lim) ? 'text-destructive' : ''}>
                        {ucasRow ? `${n}c` : `${n}/${lim || '—'}${u === 'characters' ? 'c' : 'w'}`}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-foreground/30">No essays apply to this university yet.</p>
          )}
        </div>

        <div className="grid md:grid-cols-2 gap-4">
          <div className="bg-card border border-border rounded-xl p-5">
            <h3 className="flex items-center gap-2 text-sm font-medium mb-2"><FileText className="w-4 h-4 text-foreground/40" /> Materials ({shownMaterials.length})</h3>
            {shownMaterials.length > 0 ? (
              <ul className="space-y-1">
                {shownMaterials.map((m) => (
                  <li key={m.id} className="text-sm text-foreground/60 flex items-center justify-between gap-2">
                    <span className="truncate">{m.title}{isSampleMaterial(m) ? ' (sample, not your writing)' : ''}</span>
                    <span className="text-[11px] text-foreground/40 shrink-0">{materialReadState(m)}</span>
                  </li>
                ))}
              </ul>
            ) : <p className="text-sm text-foreground/30">No materials added yet. <Link to="/materials" className="text-accent hover:underline">Add your own writing or a sample</Link>.</p>}
          </div>
          <div className="bg-card border border-border rounded-xl p-5">
            <h3 className="flex items-center gap-2 text-sm font-medium mb-2"><BookOpen className="w-4 h-4 text-foreground/40" /> University research</h3>
            {knowledge ? (
              <p className="text-sm text-foreground/50">
                Updated {startOfLocalDay(knowledge.last_updated)?.toLocaleDateString() || 'unknown'}
              </p>
            ) : (
              <p className="text-sm text-foreground/30">No research cached. The review will be less accurate without it.</p>
            )}
          </div>
        </div>

        <div className="bg-card border border-border rounded-xl p-5">
          <h3 className="flex items-center gap-2 text-sm font-medium mb-2"><ClipboardCheck className="w-4 h-4 text-foreground/40" /> Application Readiness</h3>
          <div className="flex items-center gap-4">
            <div className="flex-1">
              <div className="h-2 bg-muted rounded-full overflow-hidden">
                <div className="h-full bg-accent rounded-full" style={{ width: `${tasks.length > 0 ? (completedTasks / tasks.length) * 100 : 0}%` }} />
              </div>
              <p className="text-xs text-foreground/40 mt-1">{completedTasks}/{tasks.length} tasks completed</p>
            </div>
            <span className="text-sm capitalize text-foreground/50">{(university.status || '').replace(/_/g, ' ')}</span>
          </div>
        </div>
      </div>

      <div className="flex flex-col items-center gap-3 py-4">
        <Button onClick={runReview} disabled={reviewing || !modelReady} size="lg" className="min-w-64">
          {reviewing ? <Loader2 className="w-5 h-5 mr-2 animate-spin" /> : <ClipboardCheck className="w-5 h-5 mr-2" />}
          {reviewing ? 'Running holistic review…' : reviewResult ? 'Re-run full application review' : 'Run full application review'}
        </Button>
        {!modelReady && (
          <p className="text-[11px] text-foreground/40">Demo mode: connect a local model in AI setup to run this review. Nothing is reviewed with placeholder text.</p>
        )}
        <div className="flex flex-col items-center gap-1">
          <p className="text-xs text-foreground/30">
            Compiles your entire application and evaluates it against {university.name}&apos;s holistic rubric
          </p>
          {cachedAt && reviewResult && (
            <p className="text-[11px] text-foreground/40">
              Last reviewed {new Date(cachedAt).toLocaleString()} — result is cached so it stays when you navigate away.
            </p>
          )}
          {reviewResult && !cachedAt && (
            <p className="text-[11px] text-foreground/40">Result cached in this browser so it survives navigation.</p>
          )}
        </div>
        {reviewResult && (
          <Button
            variant="ghost"
            size="sm"
            className="text-xs text-foreground/40"
            onClick={() => {
              clearCachedReview(id);
              setReviewResult(null);
              setCachedAt(null);
              toast.success('Cached review cleared');
            }}
          >
            Clear cached review
          </Button>
        )}
      </div>

      {reviewResult && (
        <div className="space-y-5">
          {reviewResult.gaps?.length > 0 && (
            <div className="bg-card border border-border rounded-xl p-5">
              <h3 className="font-medium text-sm mb-3">Fix these before anything else</h3>
              <ul className="space-y-2">
                {reviewResult.gaps.map((g, i) => (
                  <li key={i} className="text-sm text-foreground/60 flex gap-2.5">
                    <span className="text-accent shrink-0">•</span>{g}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <ReviewResults result={reviewResult} cachedAt={cachedAt} />
        </div>
      )}
    </div>
  );
}
function Row({ label, value }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-foreground/40 shrink-0">{label}</dt>
      <dd className="text-right truncate">{value || '—'}</dd>
    </div>
  );
}
