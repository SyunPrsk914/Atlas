import { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { base44 } from '@/api/base44Client';
import {
  GraduationCap, PenLine, FolderOpen, CheckCircle2, Calendar, ArrowRight,
  Sparkles, Library, CircleAlert, ScanText, AlertTriangle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { daysUntil } from '@/lib/dates';
import {
  getUniversityPlatform, PLATFORMS, buildSharedEssayPlan, isSharedEssay,
  normalizeUniversityName,
} from '@/lib/essayScope';

export default function Dashboard() {
  const [data, setData] = useState({ universities: [], essays: [], tasks: [], materials: [], knowledge: [], profiles: [] });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const [universities, essays, tasks, materials, knowledge, profiles] = await Promise.all([
          base44.entities.University.list(),
          base44.entities.Essay.list(),
          base44.entities.RoadmapTask.list(),
          base44.entities.Material.list(),
          base44.entities.CollegeKnowledge.list(),
          base44.entities.Profile.list(),
        ]);
        setData({ universities, essays, tasks, materials, knowledge, profiles });
      } catch (e) {
        console.error(e);
        toast.error('Could not load your dashboard', { description: e.message });
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // The next best action, derived from what is actually missing.
  const nextActions = useMemo(() => {
    const actions = [];
    const { universities, essays, materials, knowledge, profiles } = data;

    if (!profiles.length) {
      actions.push({
        to: '/profile',
        icon: GraduationCap,
        title: 'Fill in your profile',
        detail: 'Nothing else works properly until this does. Essays, reviews and research all start here.',
        tone: 'urgent',
      });
    }

    for (const u of universities) {
      const platform = getUniversityPlatform(u);
      const researched = knowledge.some(
        (k) => normalizeUniversityName(k.university_name) === normalizeUniversityName(u.name),
      );
      if (!researched) {
        actions.push({
          to: '/knowledge-base',
          icon: Library,
          title: `Research ${u.name}`,
          detail: 'Deadlines, admitted-student profile, and what each essay prompt actually tests.',
          tone: 'normal',
        });
      }
      const missing = buildSharedEssayPlan(platform, essays);
      if (missing.length) {
        actions.push({
          to: `/essay-builder?university=${u.id}`,
          icon: PenLine,
          title: `Add ${missing.length} shared ${PLATFORMS[platform]?.short} essay${missing.length > 1 ? 's' : ''}`,
          detail: PLATFORMS[platform]?.sharedNote,
          tone: 'normal',
        });
        break; // one call to action at a time
      }
    }

    const unanalyzed = materials.filter((m) => m.content && m.content.trim() && !m.analysis).length;
    if (unanalyzed) {
      actions.push({
        to: '/materials',
        icon: ScanText,
        title: `Analyze ${unanalyzed} material${unanalyzed > 1 ? 's' : ''} word by word`,
        detail: 'Find the stock phrases, the vague sentences and the over-length ones before an admissions officer does.',
        tone: 'normal',
      });
    }

    return actions.slice(0, 4);
  }, [data]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32">
        <div className="w-8 h-8 border-2 border-border border-t-foreground rounded-full animate-spin" />
      </div>
    );
  }

  const completedTasks = data.tasks.filter((t) => t.completed).length;
  const totalTasks = data.tasks.length;
  const progress = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

  const upcomingDeadlines = data.universities
    .filter((u) => u.deadline)
    .sort((a, b) => String(a.deadline).localeCompare(String(b.deadline)))
    .slice(0, 6);

  const sharedEssays = data.essays.filter(isSharedEssay).length;
  const unwritten = data.essays.filter((e) => !e.content || !e.content.trim()).length;

  const stats = [
    { label: 'Universities', value: data.universities.length, icon: GraduationCap, link: '/universities' },
    { label: 'Essays', value: data.essays.length, icon: PenLine, link: '/essay-builder', sub: sharedEssays ? `${sharedEssays} shared` : null },
    { label: 'Tasks done', value: `${completedTasks}/${totalTasks}`, icon: CheckCircle2, link: '/universities' },
    { label: 'Research reports', value: data.knowledge.length, icon: Library, link: '/knowledge-base' },
  ];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-3xl font-semibold tracking-tight">Welcome back</h1>
        <p className="text-foreground/50 mt-1.5">Your college application journey, all in one place.</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((stat) => (
          <Link key={stat.label} to={stat.link} className="group">
            <div className="bg-card border border-border rounded-xl p-5 hover:border-foreground/20 transition-all">
              <div className="flex items-center justify-between mb-3">
                <stat.icon className="w-5 h-5 text-foreground/40" />
                <ArrowRight className="w-4 h-4 text-foreground/20 group-hover:text-foreground/50 group-hover:translate-x-0.5 transition-all" />
              </div>
              <div className="font-display text-2xl font-semibold">{stat.value}</div>
              <div className="text-sm text-foreground/50 mt-0.5">{stat.label}</div>
              {stat.sub && <div className="text-[11px] text-foreground/35 mt-0.5">{stat.sub}</div>}
            </div>
          </Link>
        ))}
      </div>

      {nextActions.length > 0 && (
        <div className="bg-card border border-border rounded-xl p-6">
          <div className="flex items-center gap-2 mb-4">
            <Sparkles className="w-4 h-4 text-foreground/40" />
            <h2 className="font-display text-lg font-semibold">Do this next</h2>
          </div>
          <div className="space-y-1.5">
            {nextActions.map((a) => (
              <Link key={a.title} to={a.to} className="flex items-start gap-3 p-3 rounded-lg hover:bg-muted transition group">
                <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
                  a.tone === 'urgent' ? 'bg-red-50' : 'bg-foreground/5'
                }`}>
                  <a.icon className={`w-4 h-4 ${a.tone === 'urgent' ? 'text-red-500' : 'text-foreground/50'}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm">{a.title}</div>
                  <div className="text-xs text-foreground/40">{a.detail}</div>
                </div>
                <ArrowRight className="w-4 h-4 text-foreground/20 group-hover:text-foreground/50 mt-1.5 transition" />
              </Link>
            ))}
          </div>
        </div>
      )}

      {unwritten > 0 && (
        <div className="flex items-start gap-3 p-4 rounded-xl bg-amber-50 border border-amber-200">
          <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-amber-800">
              {unwritten} essay{unwritten > 1 ? 's are' : ' is'} still blank
            </p>
            <p className="text-sm text-amber-700/80 mt-0.5">
              A blank essay is scored as a weakness in the holistic review, and universities will not wait for it.
            </p>
            <Link to="/essay-builder">
              <Button size="sm" variant="outline" className="mt-2.5 border-amber-300">Open Essay Builder</Button>
            </Link>
          </div>
        </div>
      )}

      <div className="bg-card border border-border rounded-xl p-6">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="font-display text-lg font-semibold">Overall Progress</h2>
            <p className="text-sm text-foreground/50 mt-0.5">{completedTasks} of {totalTasks} roadmap tasks completed</p>
          </div>
          <span className="font-display text-3xl font-semibold text-accent">{progress}%</span>
        </div>
        <div className="h-2 bg-muted rounded-full overflow-hidden">
          <div className="h-full bg-accent rounded-full transition-all duration-500" style={{ width: `${progress}%` }} />
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        <div className="bg-card border border-border rounded-xl p-6">
          <div className="flex items-center gap-2 mb-4">
            <Calendar className="w-4 h-4 text-foreground/40" />
            <h2 className="font-display text-lg font-semibold">Upcoming Deadlines</h2>
          </div>
          {upcomingDeadlines.length === 0 ? (
            <p className="text-sm text-foreground/40 py-8 text-center">
              No deadlines set. UK courses close on 15 Oct 2026 (Oxbridge, medicine) or 13 Jan 2027 (everything else).
            </p>
          ) : (
            <div className="space-y-1.5">
              {upcomingDeadlines.map((uni) => {
                const daysLeft = daysUntil(uni.deadline) ?? 0;
                return (
                  <Link key={uni.id} to={`/universities/${uni.id}`} className="flex items-center justify-between p-3 rounded-lg hover:bg-muted transition group">
                    <div className="min-w-0">
                      <div className="font-medium text-sm truncate">{uni.name}</div>
                      <div className="text-xs text-foreground/40">{uni.application_type || 'No round set'}</div>
                    </div>
                    <div className="text-right shrink-0 ml-3">
                      <div className="text-sm font-medium">{new Date(uni.deadline).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</div>
                      <div className={`text-xs ${daysLeft < 0 ? 'text-foreground/30' : daysLeft < 30 ? 'text-destructive' : 'text-foreground/40'}`}>
                        {daysLeft < 0 ? 'Passed' : `${daysLeft} days left`}
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </div>

        <div className="bg-card border border-border rounded-xl p-6">
          <div className="flex items-center gap-2 mb-4">
            <FolderOpen className="w-4 h-4 text-foreground/40" />
            <h2 className="font-display text-lg font-semibold">Your tools</h2>
          </div>
          <div className="space-y-1.5">
            {[
              { to: '/essay-builder', icon: PenLine, title: 'Essay Builder', detail: 'Shared writing written once; school-specific writing written once each' },
              { to: '/knowledge-base', icon: Library, title: 'Knowledge Base', detail: 'Source-checked research on any university' },
              { to: '/materials', icon: FolderOpen, title: 'Materials', detail: `${data.materials.length} uploaded · ${data.materials.filter((m) => m.analysis).length} analyzed word by word` },
            ].map((item) => (
              <Link key={item.to} to={item.to} className="flex items-center gap-3 p-3 rounded-lg hover:bg-muted transition group">
                <div className="w-9 h-9 rounded-lg bg-foreground/5 flex items-center justify-center">
                  <item.icon className="w-4 h-4 text-foreground/50" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm">{item.title}</div>
                  <div className="text-xs text-foreground/40">{item.detail}</div>
                </div>
                <ArrowRight className="w-4 h-4 text-foreground/20 group-hover:text-foreground/50 transition" />
              </Link>
            ))}
          </div>
          {data.materials.some((m) => m.content && m.content.trim() && !m.analysis) && (
            <div className="flex items-start gap-2 mt-4 pt-4 border-t border-border text-xs text-foreground/45">
              <CircleAlert className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              Some materials have text but have not been analyzed word by word yet.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}