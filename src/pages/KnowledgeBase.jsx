import { useState, useEffect, useCallback, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Search, Loader2, Library, RefreshCw, Clock, Trash2, Globe,
  ExternalLink, CheckCircle2, AlertTriangle, FileText, ChevronDown,
} from 'lucide-react';
import { runAI, refreshAIStatus } from '@/lib/ai';
import { buildProfileContext } from '@/lib/profileContext';
import { getUniversityPlatform, PLATFORMS, universityNamesMatch, universityMatchKey } from '@/lib/essayScope';
import { daysSince } from '@/lib/dates';

// ---------------------------------------------------------------------------
// Research prompt
// ---------------------------------------------------------------------------
// This used to be one giant prompt asking for "detailed, fact-based information"
// with no output structure, so the result was a wall of prose the app could
// not re-use. It now asks for a fixed set of sections and, critically, asks
// for the current cycle's essay requirements so the Essay Builder can work
// with the result instead of re-researching them.
function buildResearchPrompt({ uniName, platform, major, profileText, isUK }) {
  const platformLabel = PLATFORMS[platform]?.label || 'the university’s application system';

  return `You are a senior international admissions researcher. Research ${uniName} admissions using OFFICIAL primary sources only: the university's own admissions pages, its Common Data Set (if the US school publishes one), the UCAS/UC/Common App pages for the platform it uses, and official admissions publications. Today is 30 September 2026, so the relevant cycle is 2026-27 applications for Fall 2027 entry.

STUDENT CONTEXT (use this to make the research specific, not generic):
${profileText || 'No profile saved yet — research for a strong international applicant and note what you assumed.'}

${isUK ? 'This is a UK university. Cover UCAS: the course choice structure, whether it uses the 15 October 2026 or 13 January 2027 deadline, any written admissions test, any additional questionnaire or portal beyond UCAS, and the current UCAS personal statement rules (three fixed questions, 4,000 characters total including spaces, 350 characters minimum per answer, ONE statement sent to every course choice).' : `This university applies via ${platformLabel}. Say exactly which platform it uses, and which essay writing is SHARED across that platform versus specific to this school.`}

Write the report in markdown using EXACTLY these section headings, in this order. Keep each section tight and factual — no filler, no restating the question.

## 1. ADMISSIONS OVERVIEW
Application platform, application fee, the 2026-27 deadlines (Early/Regular/REEA/ED where relevant, with exact dates), and the most recent available acceptance rate with the year it refers to.

## 2. ACADEMIC REQUIREMENTS
Required and recommended subjects, the middle 50% GPA range, the middle 50% SAT/ACT range if published, English proficiency minimums (IELTS/TOEFL/Duolingo, including any per-component minimum), and any test-optional policy.

## 3. IDEAL STUDENT PROFILE
What the university says it looks for, the values behind that, and what admitted students actually have in common. Distinguish "officially stated" from "widely reported".

## 4. ESSAY REQUIREMENTS
For EVERY required essay: the exact prompt text, the word or character limit, and — most importantly — what ROLE that prompt plays in the holistic review (what the committee is trying to learn from that specific question). Flag clearly which writing is shared across the whole platform and which is this school alone.

## 5. PROGRAMS AND MAJORS
${major ? `Programmes related to ${major}. ` : ''}Notable programmes, research opportunities, combined or dual degrees, and any programme-specific admissions requirements.

## 6. FINANCIAL AID
Need-blind or need-aware, specifically for international students. Scholarships open to international applicants. Average award if published.

## 7. INTERVIEW
Required, optional or none. Format, length, and what it assesses.

## 8. INTERNATIONAL APPLICANT NOTES
Anything specific to international students, plus anything that constrains this student's application given the context above.

Rules: state the year for every statistic. If something is genuinely unknown, write "Not published" rather than guessing — a confident wrong number is worse than an admitted gap.`;
}

// ---------------------------------------------------------------------------
// Section extraction so the report can be scanned instead of only read.
// ---------------------------------------------------------------------------
const SECTIONS = [
  { key: 'overview', label: 'Overview', match: /^1[.)]?\s*admissions overview/i },
  { key: 'academic', label: 'Academic', match: /^2[.)]?\s*academic requirements/i },
  { key: 'profile', label: 'Ideal Student', match: /^3[.)]?\s*ideal student/i },
  { key: 'essays', label: 'Essays', match: /^4[.)]?\s*essay requirements/i },
  { key: 'programs', label: 'Programs', match: /^5[.)]?\s*programs/i },
  { key: 'aid', label: 'Financial Aid', match: /^6[.)]?\s*financial aid/i },
  { key: 'interview', label: 'Interview', match: /^7[.)]?\s*interview/i },
  { key: 'international', label: 'International', match: /^8[.)]?\s*international/i },
];

function splitSections(markdown = '') {
  const found = new Map();
  const lines = markdown.split('\n');
  let current = null;
  let buffer = [];

  const flush = () => {
    if (current) found.set(current, buffer.join('\n').trim());
    buffer = [];
  };

  for (const line of lines) {
    const heading = line.match(/^#{1,4}\s*(.*)$/);
    if (heading) {
      const hit = SECTIONS.find((s) => s.match.test(heading[1].trim()));
      if (hit) {
        flush();
        current = hit.key;
        continue;
      }
      if (current) {
        flush();
        current = null;
        continue;
      }
    }
    if (current) buffer.push(line);
  }
  flush();

  const hasAny = SECTIONS.some((s) => found.has(s.key));
  if (!hasAny) return null;
  return SECTIONS.map((s) => ({ ...s, body: found.get(s.key) || '' }));
}

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

function previewOf(markdown = '', max = 190) {
  const plain = markdown
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/[*_`>#-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return plain.length > max ? `${plain.slice(0, max).trimEnd()}…` : plain;
}

const relativeTime = (iso) => {
  if (!iso) return 'Unknown';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 'Unknown';
  const days = daysSince(iso) ?? 0;
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 30) return `${days} days ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

export default function KnowledgeBase() {
  const [universities, setUniversities] = useState([]);
  const [profile, setProfile] = useState(null);
  const [library, setLibrary] = useState([]);
  const [selectedKey, setSelectedKey] = useState(null);
  const [loading, setLoading] = useState(true);
  const [researching, setResearching] = useState(false);
  const [customName, setCustomName] = useState('');
  const [useCustom, setUseCustom] = useState(false);
  const [lastMeta, setLastMeta] = useState(null);
  const [aiStatus, setAiStatus] = useState(null);
  const [openSection, setOpenSection] = useState(null);
  const [query, setQuery] = useState('');

  const loadLibrary = useCallback(async () => {
    const rows = await base44.entities.CollegeKnowledge.list();
    // Newest research first — the thing you just did is the thing you want.
    setLibrary([...rows].sort((a, b) => String(b.last_updated || '').localeCompare(String(a.last_updated || ''))));
    return rows;
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const [unis, profiles, rows] = await Promise.all([
          base44.entities.University.list(),
          base44.entities.Profile.list(),
          loadLibrary(),
        ]);
        setUniversities(unis);
        if (profiles.length > 0) setProfile(profiles[0]);
        // Land on the most recent report instead of an empty screen — this is
        // what made the tab look broken when reports already existed.
        if (rows.length > 0) {
          const latest = [...rows].sort((a, b) => String(b.last_updated || '').localeCompare(String(a.last_updated || '')))[0];
          setSelectedKey(latest.university_name);
        }
      } catch (e) {
        console.error(e);
        toast.error('Could not load the Knowledge Base', {
          description: e.message || 'Unexpected error while reading your saved research.',
        });
      } finally {
        setLoading(false);
      }
    })();
    refreshAIStatus().then(setAiStatus);
  }, [loadLibrary]);

  // Universities on the list that have no research yet — the actual next action.
  const missing = useMemo(() => {
    const done = new Set(library.map((k) => universityMatchKey(k.university_name)));
    return universities.filter((u) => !done.has(universityMatchKey(u.name)));
  }, [universities, library]);

  const selected = useMemo(() => {
    if (!selectedKey) return null;
    return library.find((k) => k.university_name === selectedKey)
      || library.find((k) => universityNamesMatch(k.university_name, selectedKey))
      || null;
  }, [library, selectedKey]);

  const sections = useMemo(
    () => (selected ? splitSections(selected.knowledge) : null),
    [selected],
  );

  const filteredLibrary = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return library;
    return library.filter((k) => k.university_name.toLowerCase().includes(q));
  }, [library, query]);

  const targetName = useCustom ? customName.trim() : (selectedKey || '');
  const targetUniversity = useCustom
    ? null
    : universities.find((u) => u.name === selectedKey) || null;
  const isUK = targetUniversity?.country === 'UK' || /,\s*(UK|United Kingdom)$/i.test(targetName);
  // Whether THIS target already has a report. Using "is anything selected"
  // instead would label the button "Refresh" for a school that has never been
  // researched, which reads as though a report already exists.
  const targetResearched = !!library.find(
    (k) => universityNamesMatch(k.university_name, targetName),
  );

  const handleResearch = async () => {
    const uniName = targetName;
    if (!uniName) return;

    setResearching(true);
    setLastMeta(null);
    try {
      const platform = targetUniversity ? getUniversityPlatform(targetUniversity) : (isUK ? 'ucas' : 'common_app');
      const profileText = buildProfileContext(profile);

      const { ok, result, meta } = await runAI(
        {
          prompt: buildResearchPrompt({
            uniName,
            platform,
            major: targetUniversity?.major,
            profileText,
            isUK,
          }),
          // Web grounding is what makes this feature worth having — ask for it.
          // The server tells us honestly if it could not be honoured.
          // No model is pinned here: the server picks the provider's current
          // default, so this keeps working as models are retired.
          add_context_from_internet: true,
        },
        { fallbackTitle: `Research failed for ${uniName}` },
      );
      if (!ok) return;

      const knowledgeText = typeof result === 'string' ? result.trim() : JSON.stringify(result, null, 2);
      if (!knowledgeText) {
        toast.error('The AI returned an empty report', {
          description: 'Nothing was saved. Try again, or research a different university.',
        });
        return;
      }

      const stamp = new Date().toISOString();
      // "Stanford" and "Stanford University" are the same report.
      const existing = (await loadLibrary()).find((k) => universityNamesMatch(k.university_name, uniName));

      const saved = existing
        ? await base44.entities.CollegeKnowledge.update(existing.id, { knowledge: knowledgeText, last_updated: stamp })
        : await base44.entities.CollegeKnowledge.create({ university_name: uniName, knowledge: knowledgeText, last_updated: stamp });

      await loadLibrary();
      setSelectedKey(uniName);
      setOpenSection(null);
      setLastMeta(meta);
      setUseCustom(false);
      setCustomName('');
      toast.success(`Research saved for ${uniName}`, {
        description: existing ? 'Existing report refreshed.' : 'Added to your Knowledge Base.',
      });
      if (saved?.knowledge === undefined) {
        toast.warning('The report was generated but could not be saved', {
          description: 'Check that your Supabase RLS policies allow writes to college_knowledge.',
        });
      }
    } finally {
      setResearching(false);
    }
  };

  const handleDelete = async (record) => {
    if (!window.confirm(`Delete the ${record.university_name} report? You can always research it again.`)) return;
    try {
      await base44.entities.CollegeKnowledge.delete(record.id);
      await loadLibrary();
      if (universityNamesMatch(selectedKey, record.university_name)) setSelectedKey(null);
      toast.success(`Deleted the ${record.university_name} report`);
    } catch (e) {
      toast.error('Could not delete the report', { description: e.message });
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32">
        <div className="w-8 h-8 border-2 border-border border-t-foreground rounded-full animate-spin" />
      </div>
    );
  }

  const aiOffline = aiStatus && aiStatus.reachable && aiStatus.configured === false;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-display text-3xl font-semibold tracking-tight">Knowledge Base</h1>
          <p className="text-foreground/50 mt-1.5">
            Deep, source-checked research on any university — deadlines, requirements, ideal student, and essay
            roles. Every report feeds the Essay Builder and the application review.
          </p>
        </div>
        {aiStatus && (
          <AIStatusPill status={aiStatus} />
        )}
      </div>

      {aiOffline && (
        <div className="flex items-start gap-3 p-4 rounded-xl bg-amber-50 border border-amber-200">
          <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-amber-800">No AI provider is connected</p>
            <p className="text-sm text-amber-700/80 mt-0.5">
              Research, essay generation and reviews will return clearly-marked placeholder text until you add
              <span className="font-mono"> GEMINI_API_KEY </span>
              (recommended — it also enables live web grounding) to your Vercel project. See DEPLOYMENT.md, Part 2.
            </p>
          </div>
        </div>
      )}

      <div className="grid lg:grid-cols-[300px_1fr] gap-6 items-start">
        {/* ---------------- Library sidebar ---------------- */}
        <div className="space-y-4 lg:sticky lg:top-8">
          <div className="bg-card border border-border rounded-xl p-4 space-y-3">
            <label className="block text-xs font-medium text-foreground/50">
              Research a university
            </label>

            <Select
              value={useCustom ? '__custom__' : (selectedKey || '')}
              onValueChange={(v) => {
                if (v === '__custom__') { setUseCustom(true); return; }
                setUseCustom(false);
                setSelectedKey(v);
              }}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Choose from your list..." />
              </SelectTrigger>
              <SelectContent>
                {universities.map((u) => {
                  const done = library.some((k) => universityNamesMatch(k.university_name, u.name));
                  return (
                    <SelectItem key={u.id} value={u.name}>
                      {u.name}{done ? '  ✓' : ''}
                    </SelectItem>
                  );
                })}
                <SelectItem value="__custom__">— Or type any university —</SelectItem>
              </SelectContent>
            </Select>

            {useCustom && (
              <Input
                value={customName}
                onChange={(e) => setCustomName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleResearch()}
                placeholder="e.g. Harvard University"
              />
            )}

            <Button
              onClick={handleResearch}
              disabled={researching || !targetName}
              className="w-full"
            >
              {researching ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Search className="w-4 h-4 mr-2" />}
              {researching ? 'Researching…' : targetResearched ? 'Refresh research' : 'Research university'}
            </Button>

            <p className="text-xs text-foreground/40 flex items-start gap-1.5">
              <Clock className="w-3 h-3 mt-0.5 shrink-0" />
              Uses live web search across official sources. Usually 20-60 seconds.
            </p>

            {profile && (
              <p className="text-xs text-foreground/40">
                Tailored to: {profile.requires_financial_aid === false ? 'full-pay' : 'needs aid'},{' '}
                {profile.nationality || 'international'}
                {profile.school_system ? `, ${profile.school_system}` : ''}
              </p>
            )}
          </div>

          {/* Saved reports */}
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-border flex items-center justify-between gap-2">
              <span className="text-sm font-medium">Saved reports ({library.length})</span>
              {library.length > 3 && (
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Filter…"
                  className="h-7 text-xs py-1 px-2"
                />
              )}
            </div>

            {library.length === 0 ? (
              <p className="text-xs text-foreground/40 p-4 text-center">
                Nothing researched yet. Pick a university above and run your first report.
              </p>
            ) : (
              <div className="max-h-[420px] overflow-y-auto divide-y divide-border">
                {filteredLibrary.map((record) => {
                  const active = universityNamesMatch(record.university_name, selectedKey);
                  return (
                    <div key={record.id} className={`group flex items-start gap-1 px-3 py-2.5 ${active ? 'bg-muted/60' : ''}`}>
                      <button
                        onClick={() => { setSelectedKey(record.university_name); setUseCustom(false); }}
                        className="flex-1 text-left min-w-0"
                      >
                        <span className={`block text-sm truncate ${active ? 'font-medium' : ''}`}>
                          {record.university_name}
                        </span>
                        <span className="block text-[11px] text-foreground/40">
                          {relativeTime(record.last_updated)} · {previewOf(record.knowledge, 46)}
                        </span>
                      </button>
                      <button
                        onClick={() => handleDelete(record)}
                        className="opacity-0 group-hover:opacity-100 p-1.5 rounded text-foreground/25 hover:text-destructive transition shrink-0"
                        title="Delete report"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  );
                })}
                {filteredLibrary.length === 0 && (
                  <p className="text-xs text-foreground/40 p-4 text-center">No report matches “{query}”.</p>
                )}
              </div>
            )}
          </div>

          {missing.length > 0 && (
            <div className="bg-card border border-border rounded-xl p-4">
              <h3 className="text-sm font-medium mb-2 flex items-center gap-2">
                <Globe className="w-3.5 h-3.5 text-foreground/40" />
                Not researched yet
              </h3>
              <ul className="space-y-1">
                {missing.slice(0, 8).map((u) => (
                  <li key={u.id}>
                    <button
                      onClick={() => { setUseCustom(false); setSelectedKey(u.name); }}
                      className="text-xs text-accent hover:underline text-left"
                    >
                      {u.name}
                    </button>
                  </li>
                ))}
              </ul>
              {missing.length > 8 && (
                <p className="text-[11px] text-foreground/35 mt-1.5">+{missing.length - 8} more</p>
              )}
            </div>
          )}
        </div>

        {/* ---------------- Report viewer ---------------- */}
        <div className="space-y-4 min-w-0">
          {researching && (
            <div className="bg-card border border-border rounded-xl p-16 text-center">
              <Loader2 className="w-8 h-8 text-accent mx-auto mb-4 animate-spin" />
              <p className="text-sm text-foreground/50">
                Researching official sources for {targetName}…
              </p>
              <p className="text-xs text-foreground/30 mt-1">This usually takes 20-60 seconds. Keep this tab open.</p>
            </div>
          )}

          {!researching && lastMeta && (
            <div className={`flex items-start gap-2.5 p-3 rounded-xl border text-xs ${
              lastMeta.grounded
                ? 'bg-green-50 border-green-200 text-green-800'
                : 'bg-amber-50 border-amber-200 text-amber-800'
            }`}>
              {lastMeta.grounded
                ? <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                : <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />}
              <span>
                {lastMeta.grounded
                  ? `Researched with live web search${lastMeta.model ? ` (${lastMeta.model})` : ''}.`
                  : lastMeta.warning || 'This report was written from model knowledge, not live sources.'}
              </span>
            </div>
          )}

          {!researching && selected && (
            <>
              <div className="bg-card border border-border rounded-xl p-5 flex items-start justify-between gap-4 flex-wrap">
                <div className="min-w-0">
                  <h2 className="font-display text-xl font-semibold truncate">{selected.university_name}</h2>
                  <p className="text-xs text-foreground/40 mt-0.5">
                    Last updated {relativeTime(selected.last_updated).toLowerCase()}
                    {selected.last_updated ? ` · ${new Date(selected.last_updated).toLocaleString()}` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => navigator.clipboard?.writeText(selected.knowledge || '')}
                    title="Copy the full report"
                  >
                    <FileText className="w-3.5 h-3.5 mr-1.5" /> Copy
                  </Button>
                  {targetUniversity && (
                    <Link to={`/essay-builder?university=${targetUniversity.id}`}>
                      <Button variant="outline" size="sm">
                        <ExternalLink className="w-3.5 h-3.5 mr-1.5" /> Write essays
                      </Button>
                    </Link>
                  )}
                  <Button variant="outline" size="sm" onClick={handleResearch} disabled={!targetName}>
                    <RefreshCw className="w-3.5 h-3.5 mr-1.5" /> Refresh
                  </Button>
                </div>
              </div>

              {sections ? (
                <div className="space-y-3">
                  <p className="text-xs text-foreground/40">
                    Eight sections — open one to read it. This structure is what the essay writer and the
                    application review read.
                  </p>
                  {sections.map((section) => (
                    <div key={section.key} className="bg-card border border-border rounded-xl overflow-hidden">
                      <button
                        onClick={() => setOpenSection(openSection === section.key ? null : section.key)}
                        className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-muted/30 transition"
                      >
                        <span className="text-sm font-medium flex items-center gap-2.5">
                          {section.body ? <CheckCircle2 className="w-4 h-4 text-green-500" /> : <AlertTriangle className="w-4 h-4 text-amber-500" />}
                          {section.label}
                        </span>
                        <ChevronDown className={`w-4 h-4 text-foreground/40 transition-transform ${openSection === section.key ? 'rotate-180' : ''}`} />
                      </button>
                      {openSection === section.key && (
                        <div className="px-6 py-4 border-t border-border">
                          {section.body ? (
                            <ReactMarkdown components={markdownComponents}>{section.body}</ReactMarkdown>
                          ) : (
                            <p className="text-sm text-foreground/35">
                              The AI did not return this section. Re-run the research, or check the full report.
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                  <details className="bg-card border border-border rounded-xl">
                    <summary className="px-5 py-3.5 text-sm font-medium cursor-pointer select-none">
                      Full report (raw)
                    </summary>
                    <div className="px-6 py-4 border-t border-border">
                      <ReactMarkdown components={markdownComponents}>{selected.knowledge}</ReactMarkdown>
                    </div>
                  </details>
                </div>
              ) : (
                <div className="bg-card border border-border rounded-xl p-6">
                  <ReactMarkdown components={markdownComponents}>{selected.knowledge}</ReactMarkdown>
                </div>
              )}
            </>
          )}

          {!researching && !selected && (
            <div className="bg-card border border-border rounded-xl p-16 text-center">
              <Library className="w-10 h-10 text-foreground/15 mx-auto mb-4" />
              <h3 className="font-display text-lg font-medium mb-1">
                {library.length === 0 ? 'No knowledge yet' : 'No report selected'}
              </h3>
              <p className="text-sm text-foreground/40 max-w-md mx-auto">
                {library.length === 0
                  ? 'Choose a university and run a research report. You get deadlines, requirements, the ideal-student profile, and exactly what each essay prompt is testing — which the Essay Builder then uses.'
                  : 'Pick one of your saved reports on the left, or research a new university.'}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
function AIStatusPill({ status }) {
  if (!status.reachable) {
    return (
      <Badge variant="outline" className="gap-1.5 text-amber-700 border-amber-300 bg-amber-50" title={status.message}>
        <AlertTriangle className="w-3 h-3" /> AI endpoint not reachable
      </Badge>
    );
  }
  if (!status.configured) {
    return (
      <Badge variant="outline" className="gap-1.5 text-amber-700 border-amber-300 bg-amber-50" title="No provider key is set on the server. See DEPLOYMENT.md part 2.">
        <AlertTriangle className="w-3 h-3" /> Demo AI
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="gap-1.5 text-green-700 border-green-300 bg-green-50">
      <CheckCircle2 className="w-3 h-3" />
      {status.provider}{status.grounding ? ' · web-grounded' : ''}
    </Badge>
  );
}

