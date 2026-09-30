import { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { toast } from 'sonner';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  ArrowLeft, Loader2, ClipboardCheck, AlertTriangle, Globe,
  GraduationCap, Briefcase, Award, DollarSign, BookOpen, ScrollText,
  Library, CheckCircle2, Circle,
} from 'lucide-react';
import {
  essaysApplicableToUniversity, getUniversityPlatform, PLATFORMS, PLATFORM_LABELS,
  PLATFORM_REQUIREMENTS, isSharedEssay, limitUnitFor, measureEssay,
  normalizeUniversityName,
} from '@/lib/essayScope';
import { buildProfileContext, ibSubjectLines } from '@/lib/profileContext';
import { runAI } from '@/lib/ai';
import { APPLICATION_REVIEW_SCHEMA, APPLICATION_REVIEW_DIMENSIONS } from '@/lib/essayPrompts';
import ReviewResults from '@/components/review/ReviewResults';

function formatEssays(essays) {
  if (!essays || essays.length === 0) return 'NO ESSAYS EXIST FOR THIS UNIVERSITY. Treat this as a material weakness and say so.';
  return essays
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
  const [knowledge, setKnowledge] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [reviewing, setReviewing] = useState(false);
  const [reviewResult, setReviewResult] = useState(null);

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

      setProfile(profiles[0] || null);
      setEssays(essaysApplicableToUniversity(allEssays, uni));
      setMaterials(mats);
      setKnowledge(
        knw.find((k) => normalizeUniversityName(k.university_name) === normalizeUniversityName(uni.name)) || null,
      );
      setTasks(tks);
    } catch (e) {
      console.error(e);
      toast.error('Could not load this application', { description: e.message });
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { loadData(); }, [loadData]);

  const runReview = async () => {
    setReviewing(true);
    setReviewResult(null);
    try {
      const p = profile || {};
      const platform = getUniversityPlatform(university);
      const knowledgeText = knowledge?.knowledge
        || 'No research cached for this university. Use your own knowledge, and say explicitly where you are estimating.';
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

RESEARCH AND IDEAL STUDENT PROFILE (from the Knowledge Base):
${knowledgeText}

HOW THIS UNIVERSITY'S WRITING WORKS:
${PLATFORM_REQUIREMENTS[platform]?.summary || ''}
${PLATFORMS[platform]?.sharedNote || ''}

THE COMPLETE APPLICATION:

--- PERSONAL AND ACADEMIC BACKGROUND ---
${profileText}
${ibLines.length ? `\nIB subject workload (${ibLines.length} subjects):\n${ibLines.join('\n')}\nTreat Higher Level subject choice as evidence of academic ambition, and note where the workload is lighter than a US applicant would expect.` : ''}

--- ESSAYS ---
${formatEssays(essays)}

--- SUPPORTING MATERIALS ---
${materials.length > 0
    ? materials.map((m) => `--- ${m.title} [${m.type}] ---\n${m.content || m.link_url || m.notes || ''}`).join('\n\n')
    : 'No supporting materials.'}

--- READINESS ---
- Roadmap tasks completed: ${completedTasks}/${tasks.length}
- Application status: ${university.status}
${university.deadline ? `- Deadline: ${university.deadline}` : '- No deadline set'}
- Research available: ${knowledge ? 'yes' : 'NO — you are judging without institutional data, and must flag that'}

SCORE EACH OF THESE DIMENSIONS 1-10, WITH A SPECIFIC ASSESSMENT (use exactly these names, in this order):
${dimensionList}

RETURN FORMAT — use exactly these field names:
- "acceptance_probability": your single best estimate as a number 0-100.
- "verdict": one of "Hard Reach", "Reach", "Target", "Likely", "Safety".
- "dimensions": one entry per dimension above, in that order, each { "name", "score" (1-10), "assessment" }.
- "key_strengths", "key_weaknesses", "what_would_help", "gaps": arrays of short, concrete sentences. No vague advice — each item must name something the applicant can actually do or check.
- "summary": three or four sentences of overall assessment, in the voice of a reader who has just finished the file.

Return JSON only.`;
      const { ok, result } = await runAI(
        { prompt, response_json_schema: APPLICATION_REVIEW_SCHEMA },
        { fallbackTitle: 'The review could not be completed' },
      );
      if (!ok) return;
      setReviewResult(result);
      toast.success('Review complete', {
        description: `${result.verdict} · ${Math.round(result.acceptance_probability || 0)}% estimated acceptance.`,
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
      {(sharedMissing || unwritten > 0 || !knowledge || !profile) && (
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
                No research for this university — the review is running without institutional data. <Link to="/knowledge-base" className="text-accent hover:underline">Research it</Link>
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
                <span className="block text-[11px] text-foreground/35 mt-0.5">{p.ib_subjects}</span>
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
          {essays.length > 0 ? (
            <div className="space-y-2">
              {essays.map((e) => {
                const u = limitUnitFor(e);
                const n = measureEssay(e.content || '', u);
                const lim = Number(e.word_limit) || 0;
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
                      <span className={n > lim ? 'text-destructive' : ''}>{n}/{lim || '—'}{u === 'characters' ? 'c' : 'w'}</span>
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
            <h3 className="flex items-center gap-2 text-sm font-medium mb-2"><DollarSign className="w-4 h-4 text-foreground/40" /> Materials ({materials.length})</h3>
            {materials.length > 0 ? (
              <p className="text-sm text-foreground/50">{materials.map((m) => m.title).join(', ')}</p>
            ) : <p className="text-sm text-foreground/30">No materials uploaded.</p>}
          </div>
          <div className="bg-card border border-border rounded-xl p-5">
            <h3 className="flex items-center gap-2 text-sm font-medium mb-2"><BookOpen className="w-4 h-4 text-foreground/40" /> Research</h3>
            {knowledge ? (
              <p className="text-sm text-foreground/50">
                Updated {knowledge.last_updated ? new Date(knowledge.last_updated).toLocaleDateString() : 'unknown'}
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
        <Button onClick={runReview} disabled={reviewing} size="lg" className="min-w-64">
          {reviewing ? <Loader2 className="w-5 h-5 mr-2 animate-spin" /> : <ClipboardCheck className="w-5 h-5 mr-2" />}
          {reviewing ? 'Running holistic review…' : 'Run full application review'}
        </Button>
        <p className="text-xs text-foreground/30">
          Compiles your entire application and evaluates it against {university.name}&apos;s holistic rubric
        </p>
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
          <ReviewResults result={reviewResult} />
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
