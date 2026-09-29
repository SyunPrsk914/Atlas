import { useState, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Search, Loader2, Library, RefreshCw, Clock } from 'lucide-react';

const markdownComponents = {
  h1: ({ children }) => <h1 className="font-display text-xl font-semibold mt-6 mb-3 first:mt-0">{children}</h1>,
  h2: ({ children }) => <h2 className="font-display text-lg font-semibold mt-6 mb-2.5 first:mt-0">{children}</h2>,
  h3: ({ children }) => <h3 className="font-medium text-base mt-5 mb-2">{children}</h3>,
  h4: ({ children }) => <h4 className="font-medium text-sm mt-4 mb-2 text-foreground/70">{children}</h4>,
  p: ({ children }) => <p className="text-sm text-foreground/65 leading-relaxed mb-3">{children}</p>,
  ul: ({ children }) => <ul className="list-disc pl-5 mb-3 space-y-1 text-sm text-foreground/65">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal pl-5 mb-3 space-y-1 text-sm text-foreground/65">{children}</ol>,
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer" className="text-accent underline hover:opacity-80">{children}</a>,
  code: ({ children }) => <code className="bg-muted px-1.5 py-0.5 rounded text-xs font-mono">{children}</code>,
  blockquote: ({ children }) => <blockquote className="border-l-2 border-accent/40 pl-4 italic text-foreground/60 my-3">{children}</blockquote>,
  hr: () => <hr className="border-border my-4" />,
};

export default function KnowledgeBase() {
  const [universities, setUniversities] = useState([]);
  const [profile, setProfile] = useState(null);
  const [knowledge, setKnowledge] = useState(null);
  const [selectedUni, setSelectedUni] = useState(null);
  const [loading, setLoading] = useState(true);
  const [researching, setResearching] = useState(false);
  const [customName, setCustomName] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const [unis, profiles] = await Promise.all([
          base44.entities.University.list(),
          base44.entities.Profile.list(),
        ]);
        setUniversities(unis);
        if (profiles.length > 0) setProfile(profiles[0]);
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const handleSelectUni = async (uni) => {
    setSelectedUni(uni);
    setKnowledge(null);
    try {
      const existing = await base44.entities.CollegeKnowledge.filter({ university_name: uni.name });
      if (existing.length > 0) setKnowledge(existing[0]);
    } catch (e) {
      console.error(e);
    }
  };

  const handleResearch = async () => {
    const uniName = selectedUni?.name || customName;
    if (!uniName) return;
    setResearching(true);
    setKnowledge(null);
    try {
      const major = selectedUni?.major || '';
      const nationality = profile?.nationality || 'international';
      const requiresAid = profile?.requires_financial_aid !== false;

      const financialAidSection = requiresAid
        ? `6. FINANCIAL AID (Student REQUIRES financial aid)
- Available need-based aid for international students
- CSS Profile / FAFSA requirements for international applicants
- Need-blind vs. need-aware policy for international students (critical — state which clearly)
- Scholarship opportunities available to international students
- Average financial aid package for international students if available`
        : `6. FINANCIAL AID IMPLICATIONS (Student does NOT require financial aid — full-pay applicant)
- Is this university need-aware or need-blind for international students? (Critical: if need-aware, applying full-pay is an admissions ADVANTAGE — explain why and how much it helps)
- How does applying as a full-pay international student affect admission chances quantitatively?
- What is the effect on competitiveness vs. need-aid applicants at this school?
- Are there merit-based scholarships available (not need-based)?
- What financial documentation is required to demonstrate ability to pay (bank statements, etc.)?`;

      const prompt = `Research ${uniName} admissions using official sources (university website, Common Data Set, admissions pages, official publications). Provide detailed, fact-based information for a ${nationality} international student${major ? ` applying to ${major}` : ''}.

STUDENT CONTEXT:
- Nationality: ${nationality}
- School system: ${profile?.school_system || 'International'}
- Requires financial aid: ${requiresAid ? 'Yes' : 'No (full-pay)'}
${profile?.ib_predicted_score ? `- IB predicted score: ${profile.ib_predicted_score}` : ''}

Provide comprehensive, structured information:

1. ADMISSIONS OVERVIEW
- Application deadlines (EA/ED/REA/RD or UCAS dates)
- Application platform (Common App, Coalition, UCAS, university portal)
- Acceptance rate (most recent available, with year)
- Application fee

2. ACADEMIC REQUIREMENTS
- Required and recommended courses/subjects
- GPA and test score ranges (from Common Data Set if available — include middle 50% SAT/ACT ranges)
- Standardized test requirements (SAT/ACT policy, IELTS/TOEFL minimums for international students)
- International student-specific requirements

3. IDEAL STUDENT PROFILE
- What qualities does this university explicitly state it seeks in applicants?
- What values define its community and campus culture?
- What makes a student a strong fit? What type of student thrives here?

4. ESSAY REQUIREMENTS & ROLES
- List ALL required essays and their exact prompts
- Word limits for each essay
- For EACH essay, explain what role it plays in the holistic review — what is the admissions committee trying to learn from that specific prompt? (e.g., a "roommate" essay is about personality and daily-life fit, NOT academicintellectual vitality)
- What makes a successful essay for this specific school — what do admitted students' essays tend to do well?
- Common essay mistakes to avoid at this school

5. PROGRAMS & MAJORS
- Available majors${major ? ` related to ${major}` : ''}
- Special programs, research opportunities, study abroad, dual degrees
- Notable faculty, facilities, or research centers

${financialAidSection}

7. INTERVIEW
- Interview policy (required, optional, none)
- Interview format and what to expect

8. INTERNATIONAL STUDENT NOTES
- Special requirements or considerations for ${nationality} applicants
- English proficiency requirements (IELTS/TOEFL minimums and component requirements)
- Any notable policies for international applicants

Format as clear, structured text with numbered headers and bullet points. Be specific and cite official data where possible. Do not speculate — if something is uncertain, say so.`;

      const result = await base44.integrations.Core.InvokeLLM({
        prompt,
        add_context_from_internet: true,
        model: 'gemini_3_flash',
      });

      const knowledgeText = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
      const existing = await base44.entities.CollegeKnowledge.filter({ university_name: uniName });
      let savedRecord;
      if (existing.length > 0) {
        savedRecord = await base44.entities.CollegeKnowledge.update(existing[0].id, {
          knowledge: knowledgeText,
          last_updated: new Date().toISOString(),
        });
      } else {
        savedRecord = await base44.entities.CollegeKnowledge.create({
          university_name: uniName,
          knowledge: knowledgeText,
          last_updated: new Date().toISOString(),
        });
      }
      setKnowledge(savedRecord);
    } catch (e) {
      console.error(e);
      alert('Failed to research. Please try again.');
    } finally {
      setResearching(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32">
        <div className="w-8 h-8 border-2 border-border border-t-foreground rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-semibold tracking-tight">Knowledge Base</h1>
        <p className="text-foreground/50 mt-1.5">Research any university using official sources. Adapts to your profile — financial aid, nationality, and academic background.</p>
      </div>

      <div className="bg-card border border-border rounded-xl p-5 space-y-4">
        <div className="flex items-end gap-3 flex-wrap">
          <div className="flex-1 min-w-[240px]">
            <label className="block text-xs font-medium text-foreground/50 mb-1.5">Select from your university list</label>
            <Select
              value={selectedUni?.id || ''}
              onValueChange={(v) => {
                if (v === 'custom') { setSelectedUni(null); return; }
                handleSelectUni(universities.find((u) => u.id === v));
              }}
            >
              <SelectTrigger className="w-full"><SelectValue placeholder="Choose a university..." /></SelectTrigger>
              <SelectContent>
                {universities.map((u) => (
                  <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
                ))}
                <SelectItem value="custom">— Or enter a custom name —</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {!selectedUni && (
            <div className="flex-1 min-w-[240px]">
              <label className="block text-xs font-medium text-foreground/50 mb-1.5">University name</label>
              <input
                value={customName}
                onChange={(e) => setCustomName(e.target.value)}
                placeholder="e.g. Harvard University"
                className="w-full rounded-lg border border-input bg-background px-3.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-ring transition"
              />
            </div>
          )}
          <Button onClick={handleResearch} disabled={researching || (!selectedUni && !customName)}>
            {researching ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Search className="w-4 h-4 mr-2" />}
            {researching ? 'Researching...' : 'Research University'}
          </Button>
        </div>
        <div className="flex items-center gap-4 text-xs text-foreground/40">
          <span className="flex items-center gap-1.5">
            <Clock className="w-3 h-3" />
            Uses live web search across official sources. Takes 15-30 seconds.
          </span>
          {profile && (
            <span className="flex items-center gap-1.5">
              · Adapting to profile: {profile.requires_financial_aid !== false ? 'needs aid' : 'full-pay'}, {profile.nationality || 'international'}
            </span>
          )}
        </div>
      </div>

      {researching && (
        <div className="bg-card border border-border rounded-xl p-16 text-center">
          <Loader2 className="w-8 h-8 text-accent mx-auto mb-4 animate-spin" />
          <p className="text-sm text-foreground/50">Researching official sources...</p>
          <p className="text-xs text-foreground/30 mt-1">This may take 15-30 seconds.</p>
        </div>
      )}

      {!researching && knowledge && (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="px-6 py-4 border-b border-border flex items-center justify-between">
            <div>
              <h2 className="font-display text-lg font-semibold">{knowledge.university_name}</h2>
              <p className="text-xs text-foreground/40 mt-0.5">
                Last updated: {knowledge.last_updated ? new Date(knowledge.last_updated).toLocaleString() : 'Unknown'}
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={handleResearch} disabled={researching}>
              <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
              Refresh
            </Button>
          </div>
          <div className="p-6 max-w-none">
            <ReactMarkdown components={markdownComponents}>{knowledge.knowledge}</ReactMarkdown>
          </div>
        </div>
      )}

      {!researching && !knowledge && (
        <div className="bg-card border border-border rounded-xl p-16 text-center">
          <Library className="w-10 h-10 text-foreground/15 mx-auto mb-4" />
          <h3 className="font-display text-lg font-medium mb-1">No knowledge loaded</h3>
          <p className="text-sm text-foreground/40">Select a university and click "Research" to build its complete profile.</p>
        </div>
      )}
    </div>
  );
}