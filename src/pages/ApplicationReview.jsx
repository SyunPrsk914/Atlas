import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Loader2, ClipboardCheck, AlertTriangle, FileText, Globe, GraduationCap, Briefcase, Award, DollarSign, BookOpen, ScrollText } from 'lucide-react';
import { essaysApplicableToUniversity, getUniversityPlatform, PLATFORM_LABELS } from '@/lib/essayScope';
import ReviewResults from '@/components/review/ReviewResults';

const wordCount = (text) => (text && text.trim() ? text.trim().split(/\s+/).length : 0);

function formatActivities(activities, oldText) {
  if (activities && activities.length > 0) {
    return activities.map((a, i) => {
      const grades = (a.grade_levels || []).join(', ');
      return `${i + 1}. Position: ${a.position || '—'} | Org: ${a.organization || '—'} | Type: ${a.activity_type || '—'}
   ${a.description || 'No description'}
   Grades: ${grades || '—'} | ${a.timing || '—'} | ${a.hours_per_week || '?'} hrs/wk, ${a.weeks_per_year || '?'} wks/yr`;
    }).join('\n\n');
  }
  return oldText || 'No activities listed.';
}

function formatHonors(honors) {
  if (honors && honors.length > 0) {
    return honors.map((h, i) => `${i + 1}. ${h.name || '—'} — Grade ${h.grade_level || '?'}, ${h.level || 'School'} level`).join('\n');
  }
  return 'No honors listed.';
}

function formatEssays(essays) {
  if (!essays || essays.length === 0) return 'No essays prepared.';
  return essays.map((e) => {
    const scope = e.scope === 'common' ? `Common (${PLATFORM_LABELS[e.application_platform] || e.application_platform})` : 'University-specific';
    const status = (e.status || 'not_started').replace(/_/g, ' ');
    return `--- ${e.title} (${scope}, ${e.type}, ${e.word_limit || '?'} words, ${status}) ---
${e.content || '[No content written yet — this is a GAP in the application]'}`;
  }).join('\n\n');
}

export default function ApplicationReview() {
  const { id } = useParams();
  const [university, setUniversity] = useState(null);
  const [profile, setProfile] = useState(null);
  const [essays, setEssays] = useState([]);
  const [materials, setMaterials] = useState([]);
  const [knowledge, setKnowledge] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [reviewing, setReviewing] = useState(false);
  const [reviewResult, setReviewResult] = useState(null);

  useEffect(() => {
    loadData();
  }, [id]);

  const loadData = async () => {
    try {
      const uni = await base44.entities.University.get(id);
      setUniversity(uni);
      const [profiles, allEssays, mats, knw, tks] = await Promise.all([
        base44.entities.Profile.list(),
        base44.entities.Essay.list(),
        base44.entities.Material.list(),
        base44.entities.CollegeKnowledge.filter({ university_name: uni.name }),
        base44.entities.RoadmapTask.filter({ university_id: id }),
      ]);
      setProfile(profiles[0] || null);
      setEssays(essaysApplicableToUniversity(allEssays, uni));
      setMaterials(mats);
      setKnowledge(knw[0] || null);
      setTasks(tks);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const buildReviewPrompt = () => {
    const p = profile || {};
    const platform = getUniversityPlatform(university);
    const knowledgeText = knowledge?.knowledge || 'No Common Data Set cached. Use your expert knowledge of this university.';
    const completedTasks = tasks.filter((t) => t.completed).length;

    const profileText = [
      p.nationality && `Nationality: ${p.nationality}`,
      p.school_system && `School System: ${p.school_system}`,
      p.graduation_year && `Graduation Year: ${p.graduation_year}`,
      p.background_summary && `Background:\n${p.background_summary}`,
      p.education_notes && `Education System Notes:\n${p.education_notes}`,
      p.ib_predicted_score && `IB Predicted Score: ${p.ib_predicted_score}/45`,
      p.ib_subjects && `IB Subjects:\n${p.ib_subjects}`,
      p.gpa_value && `GPA: ${p.gpa_value}/${p.gpa_scale || '?'}`,
      p.sat_math && `SAT: Math ${p.sat_math}, EBRW ${p.sat_ebrw || '?'}, Total ${(p.sat_math || 0) + (p.sat_ebrw || 0)}`,
      (p.ielts_listening || p.ielts_reading || p.ielts_writing || p.ielts_speaking) &&
        `IELTS: L${p.ielts_listening} R${p.ielts_reading} W${p.ielts_writing} S${p.ielts_speaking}`,
      p.additional_test_info && `Additional Tests:\n${p.additional_test_info}`,
      p.requires_financial_aid !== undefined && `Financial Aid: ${p.requires_financial_aid ? 'Requires need-based aid' : 'Full-pay applicant'}`,
      p.financial_aid_notes && `Financial Aid Notes:\n${p.financial_aid_notes}`,
      p.additional_context && `Additional Context:\n${p.additional_context}`,
    ].filter(Boolean).join('\n');

    const activitiesText = formatActivities(p.activities, p.activities_awards);
    const honorsText = formatHonors(p.honors);
    const essaysText = formatEssays(essays);
    const materialsText = materials.length > 0
      ? materials.map((m) => `--- ${m.title} (${m.type}) ---\n${m.content || m.link_url || m.notes || ''}`).join('\n\n')
      : 'No additional materials.';

    return `You are a senior admissions officer at ${university.name}. You are conducting a holistic review of this application using the university's Common Data Set and admissions criteria.

CRITICAL INSTRUCTIONS:
- BE STRICT. BE NEUTRAL. BE BRUTALLY HONEST.
- You are the GATEKEEPER, not the student's advocate.
- Most applicants to ${university.name} are qualified and still rejected. Being "good" is NOT sufficient for admission.
- Do NOT inflate scores. Do NOT sugarcoat. Do NOT encourage or comfort.
- A score of 5/10 means AVERAGE for the applicant pool — not bad, but not competitive.
- A score of 7/10 means strong and competitive. 9/10 means exceptional and rare.
- Base your assessment on the actual acceptance data and Common Data Set provided.
- If essays are incomplete or missing, evaluate that honestly — missing essays are a significant weakness.
- This student is applying via ${PLATFORM_LABELS[platform] || platform}.

UNIVERSITY CONTEXT (Common Data Set & Admissions Data):
${knowledgeText}

COMPLETE APPLICATION:

PERSONAL BACKGROUND:
${profileText || 'No profile data.'}

ACTIVITIES (Common App format):
${activitiesText}

HONORS (Common App format):
${honorsText}

ESSAYS:
${essaysText}

SUPPORTING MATERIALS:
${materialsText}

APPLICATION READINESS:
- Roadmap tasks completed: ${completedTasks}/${tasks.length}
- Application status: ${university.status}
${university.deadline ? `- Deadline: ${university.deadline}` : ''}

EVALUATE ACROSS THESE DIMENSIONS (score each 1-10, be strict):
1. Academic Excellence — course rigor, grades, test scores relative to ${university.name}'s admitted student profile from the CDS. Is this student at the 25th, 50th, or 75th percentile?
2. Extracurricular Distinction — depth, leadership, impact. Not just participation — did they CHANGE anything? Would an officer remember these activities?
3. Essay Quality — authenticity, prompt alignment, distinctiveness. Are these actually compelling or just competent? Are any missing?
4. Personal Character — what kind of person emerges from this application? Is that what ${university.name} values?
5. Institutional Fit — does this student align with ${university.name}'s mission, values, and community?
6. Contextual Factors — international student, educational background, financial aid status, advantages/disadvantages
7. Overall Cohesion — do the pieces work together to tell a coherent, compelling story?

Output a JSON object:
{
  "dimensions": [{ "name": string, "score": number, "assessment": string }],
  "acceptance_probability": number (strict percentage 0-100, considering ${university.name}'s selectivity and this applicant's position),
  "verdict": one of "Hard Reach", "Reach", "Target", "Likely", "Safety",
  "key_strengths": [string] (top 3 specific strengths),
  "key_weaknesses": [string] (top 3 specific weaknesses),
  "what_would_help": [string] (top 3 actionable things that would meaningfully improve odds),
  "summary": string (3-4 sentences, brutally honest)`;
  };

  const runReview = async () => {
    setReviewing(true);
    setReviewResult(null);
    try {
      const prompt = buildReviewPrompt();
      const result = await base44.integrations.Core.InvokeLLM({
        prompt,
        response_json_schema: {
          type: 'object',
          properties: {
            dimensions: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  score: { type: 'number' },
                  assessment: { type: 'string' },
                },
              },
            },
            acceptance_probability: { type: 'number' },
            verdict: { type: 'string' },
            key_strengths: { type: 'array', items: { type: 'string' } },
            key_weaknesses: { type: 'array', items: { type: 'string' } },
            what_would_help: { type: 'array', items: { type: 'string' } },
            summary: { type: 'string' },
          },
        },
      });
      setReviewResult(result);
    } catch (e) {
      console.error(e);
      alert('Failed to run review. Please try again.');
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

  if (!university) {
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

  return (
    <div className="space-y-6">
      <Link to={`/universities/${id}`} className="inline-flex items-center gap-1.5 text-sm text-foreground/40 hover:text-foreground transition">
        <ArrowLeft className="w-4 h-4" />
        Back to {university.name}
      </Link>

      <div>
        <h1 className="font-display text-3xl font-semibold tracking-tight">Application Review</h1>
        <p className="text-foreground/50 mt-1.5">{university.name} · {PLATFORM_LABELS[platform] || platform}</p>
      </div>

      {/* Strict notice */}
      <div className="flex items-start gap-3 p-4 rounded-xl bg-amber-50 border border-amber-200">
        <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-medium text-amber-800">Strict, neutral evaluation</p>
          <p className="text-sm text-amber-700/80 mt-0.5">
            The AI is instructed to be brutally honest — not on your side. Acceptance percentages are estimates based on your application data and the university's admissions profile. Most qualified applicants are still rejected at selective universities.
          </p>
        </div>
      </div>

      {/* Application Preview */}
      <div className="space-y-4">
        <h2 className="font-display text-xl font-semibold">Application Preview</h2>
        <p className="text-sm text-foreground/40 -mt-2">Everything that would be sent to {university.name}</p>

        {/* Personal & Academic */}
        <div className="grid md:grid-cols-2 gap-4">
          <div className="bg-card border border-border rounded-xl p-5">
            <h3 className="flex items-center gap-2 text-sm font-medium mb-3"><Globe className="w-4 h-4 text-foreground/40" /> Personal Background</h3>
            <dl className="space-y-1.5 text-sm">
              <div className="flex justify-between"><dt className="text-foreground/40">Nationality</dt><dd>{p.nationality || '—'}</dd></div>
              <div className="flex justify-between"><dt className="text-foreground/40">School System</dt><dd>{p.school_system || '—'}</dd></div>
              <div className="flex justify-between"><dt className="text-foreground/40">Graduation</dt><dd>{p.graduation_year || '—'}</dd></div>
              <div className="flex justify-between"><dt className="text-foreground/40">Financial Aid</dt><dd>{p.requires_financial_aid ? 'Yes' : 'No (full-pay)'}</dd></div>
            </dl>
            {p.background_summary && <p className="text-xs text-foreground/50 mt-3 pt-3 border-t border-border line-clamp-3">{p.background_summary}</p>}
          </div>

          <div className="bg-card border border-border rounded-xl p-5">
            <h3 className="flex items-center gap-2 text-sm font-medium mb-3"><GraduationCap className="w-4 h-4 text-foreground/40" /> Academic Record</h3>
            <dl className="space-y-1.5 text-sm">
              <div className="flex justify-between"><dt className="text-foreground/40">IB Predicted</dt><dd>{p.ib_predicted_score ? `${p.ib_predicted_score}/45` : '—'}</dd></div>
              <div className="flex justify-between"><dt className="text-foreground/40">GPA</dt><dd>{p.gpa_value ? `${p.gpa_value}/${p.gpa_scale || '?'}` : '—'}</dd></div>
              <div className="flex justify-between"><dt className="text-foreground/40">SAT Total</dt><dd>{p.sat_math ? `${p.sat_math + (p.sat_ebrw || 0)}` : '—'}</dd></div>
              <div className="flex justify-between"><dt className="text-foreground/40">IELTS</dt><dd>{p.ielts_listening ? `L${p.ielts_listening} R${p.ielts_reading} W${p.ielts_writing} S${p.ielts_speaking}` : '—'}</dd></div>
            </dl>
            {p.ib_subjects && <p className="text-xs text-foreground/50 mt-3 pt-3 border-t border-border">{p.ib_subjects}</p>}
          </div>
        </div>

        {/* Activities */}
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
                      {a.grade_levels?.join(', ')} · {a.timing || ''} · {a.hours_per_week || '?'}h/wk · {a.weeks_per_year || '?'}wk/yr
                    </p>
                  </div>
                </div>
              ))}
            </div>
          ) : p.activities_awards ? (
            <p className="text-sm text-foreground/50">{p.activities_awards}</p>
          ) : (
            <p className="text-sm text-foreground/30">No activities listed.</p>
          )}
        </div>

        {/* Honors */}
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

        {/* Essays */}
        <div className="bg-card border border-border rounded-xl p-5">
          <h3 className="flex items-center gap-2 text-sm font-medium mb-3"><ScrollText className="w-4 h-4 text-foreground/40" /> Essays ({essays.length})</h3>
          {essays.length > 0 ? (
            <div className="space-y-2">
              {essays.map((e) => (
                <div key={e.id} className="flex items-center justify-between text-sm py-1.5 border-b border-border last:border-0">
                  <div className="flex items-center gap-2 min-w-0">
                    <FileText className="w-3.5 h-3.5 text-foreground/30 shrink-0" />
                    <span className="font-medium truncate">{e.title}</span>
                    {e.scope === 'common' && <span className="text-xs text-accent shrink-0">Common</span>}
                  </div>
                  <div className="flex items-center gap-2 text-xs text-foreground/40 shrink-0">
                    <span className="capitalize">{(e.status || 'not_started').replace(/_/g, ' ')}</span>
                    <span>·</span>
                    <span>{wordCount(e.content)}/{e.word_limit || '—'}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-foreground/30">No essays prepared for this university.</p>
          )}
        </div>

        {/* Materials + Knowledge */}
        <div className="grid md:grid-cols-2 gap-4">
          <div className="bg-card border border-border rounded-xl p-5">
            <h3 className="flex items-center gap-2 text-sm font-medium mb-2"><DollarSign className="w-4 h-4 text-foreground/40" /> Materials ({materials.length})</h3>
            {materials.length > 0 ? (
              <p className="text-sm text-foreground/50">{materials.map((m) => m.title).join(', ')}</p>
            ) : <p className="text-sm text-foreground/30">No materials uploaded.</p>}
          </div>
          <div className="bg-card border border-border rounded-xl p-5">
            <h3 className="flex items-center gap-2 text-sm font-medium mb-2"><BookOpen className="w-4 h-4 text-foreground/40" /> Common Data Set</h3>
            {knowledge ? (
              <p className="text-sm text-foreground/50">Last updated: {knowledge.last_updated ? new Date(knowledge.last_updated).toLocaleDateString() : 'Unknown'}</p>
            ) : <p className="text-sm text-foreground/30">No CDS data. Research this university in Knowledge Base first.</p>}
          </div>
        </div>

        {/* Readiness */}
        <div className="bg-card border border-border rounded-xl p-5">
          <h3 className="flex items-center gap-2 text-sm font-medium mb-2"><ClipboardCheck className="w-4 h-4 text-foreground/40" /> Application Readiness</h3>
          <div className="flex items-center gap-4">
            <div className="flex-1">
              <div className="h-2 bg-muted rounded-full overflow-hidden">
                <div className="h-full bg-accent rounded-full" style={{ width: `${tasks.length > 0 ? (completedTasks / tasks.length) * 100 : 0}%` }} />
              </div>
              <p className="text-xs text-foreground/40 mt-1">{completedTasks}/{tasks.length} tasks completed</p>
            </div>
            <span className="text-sm capitalize text-foreground/50">{university.status.replace(/_/g, ' ')}</span>
          </div>
        </div>
      </div>

      {/* Run Review */}
      <div className="flex flex-col items-center gap-3 py-4">
        <Button onClick={runReview} disabled={reviewing} size="lg" className="min-w-64">
          {reviewing ? <Loader2 className="w-5 h-5 mr-2 animate-spin" /> : <ClipboardCheck className="w-5 h-5 mr-2" />}
          {reviewing ? 'Running Holistic Review...' : 'Run Full Application Review'}
        </Button>
        <p className="text-xs text-foreground/30">Compiles your entire application and evaluates it against {university.name}'s holistic review rubric</p>
      </div>

      {/* Results */}
      {reviewResult && <ReviewResults result={reviewResult} />}
    </div>
  );
}