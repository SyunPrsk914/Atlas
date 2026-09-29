import { useState, useEffect } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Sparkles, FileText, Plus, Save, Wand2, ClipboardCheck, Loader2, PenLine, Trash2, ChevronDown, ChevronUp, Bot } from 'lucide-react';
import EssayReviewPanel from '@/components/essay/EssayReviewPanel';
import { essaysApplicableToUniversity, PLATFORM_LABELS } from '@/lib/essayScope';

const essayTypes = [
  { value: 'personal_statement', label: 'Personal Statement' },
  { value: 'supplemental', label: 'Supplemental Essay' },
  { value: 'why_this_school', label: 'Why This School' },
  { value: 'activity', label: 'Activity Essay' },
  { value: 'scholarship', label: 'Scholarship Essay' },
  { value: 'other', label: 'Other' },
];

const statusLabels = {
  not_started: 'Not Started',
  drafting: 'Drafting',
  in_review: 'In Review',
  polishing: 'Polishing',
  final: 'Final',
};

const wordCount = (text) => (text.trim() ? text.trim().split(/\s+/).length : 0);

function formatActivitiesForAI(activities) {
  if (!activities || activities.length === 0) return null;
  return 'ACTIVITIES (Common App format):\n' + activities.map((a, i) =>
    `${i + 1}. ${a.position || ''} at ${a.organization || ''} (${a.activity_type || ''})\n   ${a.description || ''}\n   Grades: ${(a.grade_levels || []).join(', ')} | ${a.timing || ''} | ${a.hours_per_week || '?'}h/wk, ${a.weeks_per_year || '?'}wks/yr`
  ).join('\n');
}

function formatHonorsForAI(honors) {
  if (!honors || honors.length === 0) return null;
  return 'HONORS:\n' + honors.map((h, i) => `${i + 1}. ${h.name} — Grade ${h.grade_level}, ${h.level} level`).join('\n');
}

export default function EssayBuilder() {
  const [searchParams] = useSearchParams();
  const [universities, setUniversities] = useState([]);
  const [essays, setEssays] = useState([]);
  const [selectedUni, setSelectedUni] = useState(null);
  const [selectedEssay, setSelectedEssay] = useState(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [polishing, setPolishing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [reviewResult, setReviewResult] = useState(null);
  const [genAnalysis, setGenAnalysis] = useState(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [metaExpanded, setMetaExpanded] = useState(true);
  const [newEssay, setNewEssay] = useState({ title: '', type: 'supplemental', prompt: '', word_limit: 650, scope: 'university_specific' });

  useEffect(() => {
    (async () => {
      try {
        const unis = await base44.entities.University.list();
        setUniversities(unis);
        const uniParam = searchParams.get('university');
        if (uniParam) {
          const uni = unis.find((u) => u.id === uniParam);
          if (uni) setSelectedUni(uni);
        } else if (unis.length > 0) {
          setSelectedUni(unis[0]);
        }
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (selectedUni) loadEssays();
  }, [selectedUni]);

  const loadEssays = async () => {
    try {
      const ess = await base44.entities.Essay.list();
      setEssays(ess);
      const essayParam = searchParams.get('essay');
      if (essayParam) {
        const essay = ess.find((e) => e.id === essayParam);
        if (essay) {
          setSelectedEssay(essay);
          setReviewResult(null);
          setGenAnalysis(null);
        }
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleSelectUni = (uniId) => {
    const uni = universities.find((u) => u.id === uniId);
    setSelectedUni(uni);
    setSelectedEssay(null);
    setReviewResult(null);
    setGenAnalysis(null);
  };

  const handleCreateEssay = async () => {
    if (!newEssay.title) return;
    if ((newEssay.scope || 'university_specific') === 'university_specific' && !selectedUni) return;
    try {
      const essayData = {
        title: newEssay.title,
        type: newEssay.type,
        prompt: newEssay.prompt,
        word_limit: parseInt(newEssay.word_limit) || 650,
        content: '',
        status: 'not_started',
        scope: newEssay.scope || 'university_specific',
        application_platform: 'common_app',
      };
      if ((newEssay.scope || 'university_specific') === 'university_specific') {
        essayData.university_id = selectedUni.id;
        essayData.university_name = selectedUni.name;
      }
      const created = await base44.entities.Essay.create(essayData);
      setEssays([...essays, created]);
      setSelectedEssay(created);
      setDialogOpen(false);
      setNewEssay({ title: '', type: 'supplemental', prompt: '', word_limit: 650, scope: 'university_specific' });
      setReviewResult(null);
      setGenAnalysis(null);
    } catch (e) {
      console.error(e);
    }
  };

  const handleDeleteEssay = async (essay, fromList = false) => {
    if (!confirm(`Delete "${essay.title}"? This cannot be undone.`)) return;
    try {
      await base44.entities.Essay.delete(essay.id);
      setEssays(essays.filter((e) => e.id !== essay.id));
      if (selectedEssay?.id === essay.id) {
        setSelectedEssay(null);
        setReviewResult(null);
        setGenAnalysis(null);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleFieldChange = (field, value) => {
    setSelectedEssay((prev) => ({ ...prev, [field]: value }));
  };

  const handleSave = async () => {
    if (!selectedEssay) return;
    setSaving(true);
    try {
      const updated = await base44.entities.Essay.update(selectedEssay.id, {
        title: selectedEssay.title,
        prompt: selectedEssay.prompt,
        word_limit: selectedEssay.word_limit,
        content: selectedEssay.content,
        type: selectedEssay.type,
        status: selectedEssay.status,
      });
      setSelectedEssay(updated);
      setEssays(essays.map((e) => (e.id === updated.id ? updated : e)));
    } catch (e) {
      console.error(e);
    } finally {
      setSaving(false);
    }
  };

  const gatherContext = async () => {
    const [profiles, materials, knowledge] = await Promise.all([
      base44.entities.Profile.list(),
      base44.entities.Material.list(),
      base44.entities.CollegeKnowledge.filter({ university_name: selectedUni.name }),
    ]);

    const p = profiles[0] || {};
    const profileText = [
      p.nationality && `NATIONALITY: ${p.nationality}`,
      p.school_system && `SCHOOL SYSTEM: ${p.school_system}`,
      p.graduation_year && `GRADUATION YEAR: ${p.graduation_year}`,
      p.background_summary && `BACKGROUND:\n${p.background_summary}`,
      p.education_notes && `EDUCATION SYSTEM NOTES:\n${p.education_notes}`,
      p.ib_predicted_score && `IB PREDICTED SCORE: ${p.ib_predicted_score}`,
      p.ib_subjects && `IB SUBJECTS:\n${p.ib_subjects}`,
      p.gpa_value && `GPA: ${p.gpa_value}/${p.gpa_scale || '?'}`,
      p.sat_math && `SAT: Math ${p.sat_math}, EBRW ${p.sat_ebrw || '?'}, Total ${(p.sat_math || 0) + (p.sat_ebrw || 0)}`,
      (p.ielts_listening || p.ielts_reading || p.ielts_writing || p.ielts_speaking) &&
        `IELTS (highest by component): L${p.ielts_listening} R${p.ielts_reading} W${p.ielts_writing} S${p.ielts_speaking}`,
      p.additional_test_info && `ADDITIONAL TEST INFO:\n${p.additional_test_info}`,
      formatActivitiesForAI(p.activities) || (p.activities_awards && `ACTIVITIES & AWARDS:\n${p.activities_awards}`),
      formatHonorsForAI(p.honors),
      p.requires_financial_aid !== undefined && `FINANCIAL AID: ${p.requires_financial_aid ? 'Requires financial aid (need-based)' : 'Does NOT require financial aid (full-pay applicant)'}`,
      p.financial_aid_notes && `FINANCIAL AID NOTES:\n${p.financial_aid_notes}`,
      p.additional_context && `ADDITIONAL CONTEXT:\n${p.additional_context}`,
    ].filter(Boolean).join('\n\n');

    const materialsText = materials.length > 0
      ? materials.map((m) => `--- ${m.title} (${m.type}) ---\n${m.content || m.link_url || m.notes || ''}`).join('\n\n')
      : 'No additional materials uploaded.';

    const knowledgeText = knowledge.length > 0
      ? knowledge[0].knowledge
      : 'No specific university knowledge cached. Use your expert knowledge of this university.';

    return { profileText, materialsText, knowledgeText };
  };

  const handleGenerate = async () => {
    if (!selectedEssay) return;
    setGenerating(true);
    setReviewResult(null);
    setGenAnalysis(null);
    try {
      const { profileText, materialsText, knowledgeText } = await gatherContext();
      const prompt = `You are an elite college admissions essay consultant who has read thousands of admitted students' essays at top universities. You deeply understand HOLISTIC ADMISSIONS and the specific ROLE each essay plays in a student's application.

STEP 1 — UNDERSTAND THE ESSAY'S ROLE:
Before writing, analyze what THIS specific essay prompt is really asking. What is the admissions committee trying to learn from THIS particular essay? What role does it play in the holistic review alongside the other components?

Different essays serve completely different purposes:
- A Common App Personal Statement reveals WHO YOU ARE — your values, identity, growth. Not a resume in prose.
- A Stanford "Roommate" essay is about PERSONALITY and daily-life humanity — what kind of person you'd be to live with. It is NOT a place to push intellectual vitality (even though that IS a core Stanford value — but not here). It should be casual, quirky, real.
- A "Why This School" essay must show GENUINE, RESEARCHED knowledge of the school — specific programs, professors, traditions — not generic praise.
- An Activity essay is about what you LEARNED and how you GREW — not just what you did.
- Supplemental essays each have a specific purpose — understand what THIS one is asking.

Not every essay should be rooted in academics or one subject. A student is a whole person, not just their major. Different essays should reveal different facets.

STEP 2 — USE ALL AVAILABLE CONTEXT:
The student has provided extensive background. Use EVERY relevant detail — do not ignore any material.

STUDENT PROFILE:
${profileText}

ALL SUPPORTING MATERIALS (use every relevant detail from these):
${materialsText}

UNIVERSITY KNOWLEDGE & IDEAL STUDENT PROFILE:
${knowledgeText}

ESSAY TO WRITE:
- University: ${selectedUni.name}
- Program/Major: ${selectedUni.major || 'Not specified'}
- Essay type: ${selectedEssay.type}
- Prompt: ${selectedEssay.prompt || 'No specific prompt — write a strong personal statement that reveals who the student is'}
- Word limit: ${selectedEssay.word_limit || 650} words

STEP 3 — WRITE LIKE A HUMAN:
- Write in the authentic voice of a thoughtful 17-18 year old. NOT an AI. NOT a thesaurus. NOT a polished adult professional.
- Use specific, concrete details and anecdotes from the student's actual life. Show, don't tell.
- ABSOLUTELY AVOID these AI-like patterns: "In conclusion," "This experience taught me," "Through this journey," "I realized that," "It was then that I understood," "Looking back," overly polished transitions, everything in lists of three, meta-commentary about personal growth, sweeping generalizations.
- Be genuine, specific, and real. Let the student's personality come through naturally.
- The essay should read like a talented teenager wrote it — not a robot trying to sound impressive.

Output a JSON object with:
- "essay": the full essay text (just the essay, no headers, no meta-commentary)
- "essay_analysis": a brief analysis of what role this essay plays in the holistic application and how the essay serves that purpose`;

      const result = await base44.integrations.Core.InvokeLLM({
        prompt,
        response_json_schema: {
          type: 'object',
          properties: {
            essay: { type: 'string' },
            essay_analysis: { type: 'string' },
          },
        },
      });

      const updated = { ...selectedEssay, content: result.essay, status: 'drafting' };
      setSelectedEssay(updated);
      setEssays(essays.map((e) => (e.id === updated.id ? updated : e)));
      setGenAnalysis(result.essay_analysis);
      await base44.entities.Essay.update(selectedEssay.id, { content: result.essay, status: 'drafting' });
    } catch (e) {
      console.error(e);
      alert('Failed to generate essay. Please try again.');
    } finally {
      setGenerating(false);
    }
  };

  const handleReview = async () => {
    if (!selectedEssay || !selectedEssay.content) return;
    setReviewing(true);
    setReviewResult(null);
    try {
      const { knowledgeText } = await gatherContext();
      const prompt = `You are a senior admissions officer at ${selectedUni.name}. You deeply understand holistic admissions and what each specific essay is supposed to accomplish.

CRITICAL: Judge this essay by what THIS SPECIFIC PROMPT is actually asking, not by generic essay standards.
- A Stanford roommate essay that pushes intellectual vitality has MISSED THE POINT.
- A "Why this school" essay with generic praise has MISSED THE POINT.
- An essay that sounds like AI has FAILED, full stop.

ESSAY:
${selectedEssay.content}

PROMPT: ${selectedEssay.prompt || 'Personal statement'}
ESSAY TYPE: ${selectedEssay.type}
WORD LIMIT: ${selectedEssay.word_limit || 650} words

UNIVERSITY CONTEXT & IDEAL STUDENT:
${knowledgeText}

Evaluate on these dimensions:
1. PROMPT ALIGNMENT (most important): Does the essay actually answer what the prompt asks? Does it serve the specific role this essay plays in the holistic application? Rate 1-10.
2. HUMANITY: Does it sound like a real person wrote it? Or does it sound AI-generated? Flag specific AI-like phrases and patterns.
3. SPECIFICITY: Are there concrete, personal details? Or is it vague and generic?
4. NARRATIVE: Is there a clear, compelling story or structure?
5. FIT: Does it align with what this university values — as appropriate for THIS essay type specifically (not generic)?
6. CONTEXT USE: Does it draw on the student's actual background and experiences?
7. VOCABULARY: Natural and precise? Or forced, pretentious, and thesaurus-driven?
8. WORD COUNT: Current count vs. limit.

Output a JSON object with:
- "overall_score": score out of 10 (number)
- "prompt_alignment_score": score out of 10 (number)
- "word_count": actual word count (number)
- "sounds_like_ai": boolean — does it sound AI-written?
- "ai_patterns_detected": array of specific AI-like phrases or patterns found (strings), empty if none
- "strengths": array of specific strengths (strings)
- "weaknesses": array of specific weaknesses with context (strings)
- "priority_improvements": array of the top 3 most important changes (strings)
- "summary": a 2-3 sentence overall assessment (string)`;

      const result = await base44.integrations.Core.InvokeLLM({
        prompt,
        response_json_schema: {
          type: 'object',
          properties: {
            overall_score: { type: 'number' },
            prompt_alignment_score: { type: 'number' },
            word_count: { type: 'number' },
            sounds_like_ai: { type: 'boolean' },
            ai_patterns_detected: { type: 'array', items: { type: 'string' } },
            strengths: { type: 'array', items: { type: 'string' } },
            weaknesses: { type: 'array', items: { type: 'string' } },
            priority_improvements: { type: 'array', items: { type: 'string' } },
            summary: { type: 'string' },
          },
        },
      });

      setReviewResult(result);
      const updated = { ...selectedEssay, status: 'in_review', review_notes: JSON.stringify(result, null, 2) };
      setSelectedEssay(updated);
      await base44.entities.Essay.update(selectedEssay.id, { status: 'in_review', review_notes: JSON.stringify(result, null, 2) });
    } catch (e) {
      console.error(e);
      alert('Failed to run review. Please try again.');
    } finally {
      setReviewing(false);
    }
  };

  const handlePolish = async () => {
    if (!selectedEssay || !selectedEssay.content) return;
    setPolishing(true);
    try {
      const { knowledgeText } = await gatherContext();
      const reviewNotes = reviewResult
        ? JSON.stringify(reviewResult, null, 2)
        : selectedEssay.review_notes || 'No specific review notes. Improve the essay for clarity, voice, university fit, and to sound more human.';

      const prompt = `You are a master essay editor. Your goal: make this essay sound MORE HUMAN and LESS AI-WRITTEN while improving its alignment with what the specific prompt asks.

CRITICAL RULES:
1. The essay must answer what THIS SPECIFIC PROMPT asks, serving its role in holistic admissions (e.g., a roommate essay should be about personality and daily-life humanity, NOT academics).
2. Remove ALL AI-like patterns: "In conclusion," "This experience taught me," "Through this journey," "I learned that," "It was then that I realized," "Looking back," overly polished transitions, everything in lists of three, meta-commentary about growth, sweeping generalizations.
3. Make the voice sound like a real, thoughtful teenager — not a robot, not a thesaurus, not a polished adult professional.
4. Keep specific, concrete, personal details. Remove vague, generic, or performative statements.
5. Stay within ${selectedEssay.word_limit || 650} words.
6. Maintain the student's authentic background and perspective. Do not invent experiences.
7. The result should read like a talented 17-year-old wrote it — natural, specific, and real.

REVIEW NOTES TO ADDRESS:
${reviewNotes}

CURRENT ESSAY:
${selectedEssay.content}

PROMPT: ${selectedEssay.prompt || 'Personal statement'}
ESSAY TYPE: ${selectedEssay.type}
UNIVERSITY: ${selectedUni.name}
WORD LIMIT: ${selectedEssay.word_limit || 650} words

Output ONLY the revised essay text. No commentary, no headers, no meta-text. Just the essay.`;

      const result = await base44.integrations.Core.InvokeLLM({ prompt });
      const polishedText = typeof result === 'string' ? result : result.essay || String(result);
      const updated = { ...selectedEssay, content: polishedText, status: 'polishing' };
      setSelectedEssay(updated);
      setEssays(essays.map((e) => (e.id === updated.id ? updated : e)));
      await base44.entities.Essay.update(selectedEssay.id, { content: polishedText, status: 'polishing' });
    } catch (e) {
      console.error(e);
      alert('Failed to polish essay. Please try again.');
    } finally {
      setPolishing(false);
    }
  };

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

  const applicableEssays = selectedUni ? essaysApplicableToUniversity(essays, selectedUni) : essays;
  const commonEssays = applicableEssays.filter((e) => e.scope === 'common');
  const specificEssays = applicableEssays.filter((e) => e.scope !== 'common');

  const renderEssayItem = (essay) => (
    <div key={essay.id} className="group relative">
      <button
        onClick={() => { setSelectedEssay(essay); setReviewResult(null); setGenAnalysis(null); }}
        className={`w-full text-left p-3 rounded-xl border transition-all pr-8 ${
          selectedEssay?.id === essay.id
            ? 'border-foreground/20 bg-card shadow-sm'
            : 'border-border bg-card/50 hover:bg-card hover:border-foreground/10'
        }`}
      >
        <div className="flex items-center gap-2 mb-1">
          <FileText className="w-3.5 h-3.5 text-foreground/30 shrink-0" />
          <span className="text-sm font-medium truncate">{essay.title}</span>
          {essay.scope === 'common' && <span className="text-[10px] text-accent/70 shrink-0">Common</span>}
        </div>
        <div className="flex items-center gap-2 text-xs text-foreground/40">
          <span className="capitalize">{statusLabels[essay.status]}</span>
          <span>·</span>
          <span>{wordCount(essay.content || '')}/{essay.word_limit || '—'}</span>
        </div>
      </button>
      <button
        onClick={() => handleDeleteEssay(essay, true)}
        className="absolute top-2.5 right-2 p-1 rounded text-foreground/20 hover:text-destructive opacity-0 group-hover:opacity-100 transition"
      >
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </div>
  );

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-3xl font-semibold tracking-tight">Essay Builder</h1>
        <p className="text-foreground/50 mt-1.5">Your essay hub. Common App essays shared across schools, university-specific essays filtered per school. AI understands holistic admissions and essay roles.</p>
      </div>

      <div className="flex items-center gap-3">
        <span className="text-sm font-medium text-foreground/60 shrink-0">University:</span>
        <Select value={selectedUni?.id} onValueChange={handleSelectUni}>
          <SelectTrigger className="w-72"><SelectValue placeholder="Select university..." /></SelectTrigger>
          <SelectContent>
            {universities.map((u) => (
              <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid lg:grid-cols-[220px_1fr] gap-5">
        {/* Essay list sidebar */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-medium text-sm text-foreground/60">Essays</h2>
            <Button size="sm" variant="outline" onClick={() => setDialogOpen(true)}>
              <Plus className="w-3.5 h-3.5 mr-1" />
              New
            </Button>
          </div>

          {applicableEssays.length === 0 ? (
            <p className="text-xs text-foreground/40 px-1 py-4 text-center">No essays yet. Click "New" to create one.</p>
          ) : (
            <div className="space-y-4">
              {commonEssays.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-xs font-medium text-accent/80 px-1">Common App (shared)</p>
                  {commonEssays.map(renderEssayItem)}
                </div>
              )}
              {specificEssays.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-xs font-medium text-foreground/40 px-1">{selectedUni?.name || 'University'}</p>
                  {specificEssays.map(renderEssayItem)}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Essay editor */}
        <div>
          {!selectedEssay ? (
            <div className="bg-card border border-border rounded-xl p-16 text-center">
              <PenLine className="w-10 h-10 text-foreground/15 mx-auto mb-4" />
              <h3 className="font-display text-lg font-medium mb-1">Select or create an essay</h3>
              <p className="text-sm text-foreground/40">Choose an essay from the left or create a new one to start writing.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Essay metadata - collapsible */}
              <div className="bg-card border border-border rounded-xl overflow-hidden">
                <button
                  onClick={() => setMetaExpanded(!metaExpanded)}
                  className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-muted/30 transition"
                >
                  <span className="font-medium text-sm flex items-center gap-2">
                    <FileText className="w-4 h-4 text-foreground/40" />
                    {selectedEssay.title || 'Untitled Essay'}
                  </span>
                  {metaExpanded ? <ChevronUp className="w-4 h-4 text-foreground/40" /> : <ChevronDown className="w-4 h-4 text-foreground/40" />}
                </button>
                {metaExpanded && (
                  <div className="px-5 pb-5 space-y-3 border-t border-border pt-4">
                    <input
                      value={selectedEssay.title}
                      onChange={(e) => handleFieldChange('title', e.target.value)}
                      placeholder="Essay title"
                      className="w-full font-display text-base font-semibold bg-transparent border-none focus:outline-none -mt-1"
                    />
                    <div className="grid sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-medium text-foreground/50 mb-1">Type</label>
                        <Select value={selectedEssay.type} onValueChange={(v) => handleFieldChange('type', v)}>
                          <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {essayTypes.map((t) => (
                              <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-foreground/50 mb-1">Word Limit</label>
                        <Input
                          type="number"
                          value={selectedEssay.word_limit || ''}
                          onChange={(e) => handleFieldChange('word_limit', parseInt(e.target.value) || 0)}
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-foreground/50 mb-1">Prompt</label>
                      <Textarea
                        value={selectedEssay.prompt || ''}
                        onChange={(e) => handleFieldChange('prompt', e.target.value)}
                        placeholder="Paste the essay prompt here..."
                        rows={2}
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* AI action buttons */}
              <div className="flex items-center gap-2 flex-wrap">
                <Button onClick={handleGenerate} disabled={generating}>
                  {generating ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Wand2 className="w-4 h-4 mr-2" />}
                  {generating ? 'Generating...' : 'Generate Draft'}
                </Button>
                <Button onClick={handleReview} disabled={reviewing || !selectedEssay.content} variant="outline">
                  {reviewing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <ClipboardCheck className="w-4 h-4 mr-2" />}
                  {reviewing ? 'Reviewing...' : 'AO Review'}
                </Button>
                <Button onClick={handlePolish} disabled={polishing || !selectedEssay.content} variant="outline">
                  {polishing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Sparkles className="w-4 h-4 mr-2" />}
                  {polishing ? 'Polishing...' : 'Polish'}
                </Button>
                <div className="flex items-center gap-2 ml-auto">
                  <Button onClick={handleSave} disabled={saving} variant="ghost" size="sm">
                    <Save className="w-4 h-4 mr-1.5" />
                    {saving ? 'Saving...' : 'Save'}
                  </Button>
                  <Button onClick={() => handleDeleteEssay(selectedEssay)} disabled={generating || reviewing || polishing} variant="ghost" size="sm" className="text-destructive hover:text-destructive">
                    <Trash2 className="w-4 h-4 mr-1.5" />
                    Delete
                  </Button>
                </div>
              </div>

              {/* Generation analysis */}
              {genAnalysis && (
                <div className="bg-accent/5 border border-accent/20 rounded-xl p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Sparkles className="w-4 h-4 text-accent" />
                    <span className="text-sm font-medium">Essay Role Analysis</span>
                  </div>
                  <p className="text-sm text-foreground/60 leading-relaxed">{genAnalysis}</p>
                </div>
              )}

              {/* Essay editor - large */}
              <div className="bg-card border border-border rounded-xl p-5">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm font-medium text-foreground/50">Essay Content</span>
                  <span className={`text-xs font-medium ${wordCount(selectedEssay.content || '') > (selectedEssay.word_limit || Infinity) ? 'text-destructive' : 'text-foreground/40'}`}>
                    {wordCount(selectedEssay.content || '')} / {selectedEssay.word_limit || '—'} words
                  </span>
                </div>
                <textarea
                  value={selectedEssay.content || ''}
                  onChange={(e) => handleFieldChange('content', e.target.value)}
                  placeholder="Write your essay here, or click 'Generate Draft' to let AI write it based on your profile, materials, and university knowledge..."
                  rows={30}
                  className="w-full rounded-lg border border-input bg-background px-4 py-3 text-sm leading-relaxed resize-y focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-ring transition placeholder:text-foreground/25 font-body"
                />
              </div>

              {/* Review panel */}
              <EssayReviewPanel reviewResult={reviewResult} onPolish={handlePolish} polishing={polishing} />
            </div>
          )}
        </div>
      </div>

      {/* New Essay Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="font-display">New Essay</DialogTitle>
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
              <label className="block text-xs font-medium text-foreground/50 mb-1.5">Scope</label>
              <Select value={newEssay.scope || 'university_specific'} onValueChange={(v) => setNewEssay({ ...newEssay, scope: v })}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="university_specific">For this university</SelectItem>
                  <SelectItem value="common">Common App (shared across US schools)</SelectItem>
                </SelectContent>
              </Select>
              {newEssay.scope === 'common' && (
                <p className="text-xs text-foreground/30 mt-1">Shared across all Common App universities (except UC and MIT).</p>
              )}
            </div>
            <div>
              <label className="block text-xs font-medium text-foreground/50 mb-1.5">Type</label>
              <Select value={newEssay.type} onValueChange={(v) => setNewEssay({ ...newEssay, type: v })}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {essayTypes.map((t) => (
                    <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="block text-xs font-medium text-foreground/50 mb-1.5">Prompt</label>
              <Textarea
                value={newEssay.prompt}
                onChange={(e) => setNewEssay({ ...newEssay, prompt: e.target.value })}
                placeholder="Paste the essay prompt here..."
                rows={3}
              />
            </div>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                value={newEssay.word_limit}
                onChange={(e) => setNewEssay({ ...newEssay, word_limit: e.target.value })}
                placeholder="Word limit"
                className="w-28"
              />
              <span className="text-xs text-foreground/40">word limit</span>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleCreateEssay} disabled={!newEssay.title}>Create Essay</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}