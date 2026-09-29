import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { GraduationCap, PenLine, FolderOpen, CheckCircle2, Calendar, ArrowRight, Sparkles, TrendingUp } from 'lucide-react';

export default function Dashboard() {
  const [data, setData] = useState({ universities: [], essays: [], tasks: [], materials: [] });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const [universities, essays, tasks, materials] = await Promise.all([
          base44.entities.University.list(),
          base44.entities.Essay.list(),
          base44.entities.RoadmapTask.list(),
          base44.entities.Material.list(),
        ]);
        setData({ universities, essays, tasks, materials });
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

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
    .sort((a, b) => new Date(a.deadline) - new Date(b.deadline))
    .slice(0, 6);

  const stats = [
    { label: 'Universities', value: data.universities.length, icon: GraduationCap, link: '/universities' },
    { label: 'Essays', value: data.essays.length, icon: PenLine, link: '/essay-builder' },
    { label: 'Tasks Done', value: `${completedTasks}/${totalTasks}`, icon: CheckCircle2, link: '/universities' },
    { label: 'Materials', value: data.materials.length, icon: FolderOpen, link: '/materials' },
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
            </div>
          </Link>
        ))}
      </div>

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
            <p className="text-sm text-foreground/40 py-8 text-center">No deadlines set yet. Add deadlines to your universities.</p>
          ) : (
            <div className="space-y-1.5">
              {upcomingDeadlines.map((uni) => {
                const daysLeft = Math.ceil((new Date(uni.deadline) - new Date()) / (1000 * 60 * 60 * 24));
                return (
                  <Link key={uni.id} to={`/universities/${uni.id}`} className="flex items-center justify-between p-3 rounded-lg hover:bg-muted transition group">
                    <div className="min-w-0">
                      <div className="font-medium text-sm truncate">{uni.name}</div>
                      <div className="text-xs text-foreground/40">{uni.application_type || 'Regular'}</div>
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
            <Sparkles className="w-4 h-4 text-foreground/40" />
            <h2 className="font-display text-lg font-semibold">Quick Actions</h2>
          </div>
          <div className="space-y-1.5">
            <Link to="/essay-builder" className="flex items-center gap-3 p-3 rounded-lg hover:bg-muted transition group">
              <div className="w-9 h-9 rounded-lg bg-foreground/5 flex items-center justify-center">
                <PenLine className="w-4 h-4 text-foreground/50" />
              </div>
              <div className="flex-1">
                <div className="font-medium text-sm">Build an essay</div>
                <div className="text-xs text-foreground/40">AI-powered writing with admission officer review</div>
              </div>
              <ArrowRight className="w-4 h-4 text-foreground/20 group-hover:translate-x-0.5 transition" />
            </Link>
            <Link to="/knowledge-base" className="flex items-center gap-3 p-3 rounded-lg hover:bg-muted transition group">
              <div className="w-9 h-9 rounded-lg bg-foreground/5 flex items-center justify-center">
                <TrendingUp className="w-4 h-4 text-foreground/50" />
              </div>
              <div className="flex-1">
                <div className="font-medium text-sm">Research a university</div>
                <div className="text-xs text-foreground/40">Official data on requirements & ideal student</div>
              </div>
              <ArrowRight className="w-4 h-4 text-foreground/20 group-hover:translate-x-0.5 transition" />
            </Link>
            <Link to="/materials" className="flex items-center gap-3 p-3 rounded-lg hover:bg-muted transition group">
              <div className="w-9 h-9 rounded-lg bg-foreground/5 flex items-center justify-center">
                <FolderOpen className="w-4 h-4 text-foreground/50" />
              </div>
              <div className="flex-1">
                <div className="font-medium text-sm">Upload materials</div>
                <div className="text-xs text-foreground/40">Documents, links, past essays & context</div>
              </div>
              <ArrowRight className="w-4 h-4 text-foreground/20 group-hover:translate-x-0.5 transition" />
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}