import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { toast } from 'sonner';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  ArrowLeft, CheckCircle2, Circle, Plus, PenLine, Calendar, MapPin, Trash2,
  FileText, ClipboardCheck, Library, Globe, Info, AlertTriangle,
} from 'lucide-react';
import {
  essaysApplicableToUniversity, getUniversityPlatform, PLATFORMS, PLATFORM_REQUIREMENTS,
  buildSharedEssayPlan, isSharedEssay, limitUnitFor, measureEssay,
  normalizeUniversityName,
} from '@/lib/essayScope';
import { daysUntil } from '@/lib/dates';

const categoryLabels = {
  testing: 'Testing',
  application_platform: 'Application Platform',
  academic_records: 'Academic Records',
  essays: 'Essays',
  recommendations: 'Recommendations',
  financial: 'Financial Aid',
  interview: 'Interview',
  portfolio: 'Portfolio',
  submission: 'Submission',
  post_submission: 'Post-Submission',
};

const categoryOrder = ['testing', 'application_platform', 'academic_records', 'essays', 'recommendations', 'financial', 'interview', 'portfolio', 'submission', 'post_submission'];

const statusOptions = [
  { value: 'researching', label: 'Researching' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'submitted', label: 'Submitted' },
  { value: 'decided', label: 'Decided' },
];

export default function UniversityDetail() {
  const { id } = useParams();
  const [university, setUniversity] = useState(null);
  const [notFound, setNotFound] = useState(false);
  const [tasks, setTasks] = useState([]);
  const [allEssays, setAllEssays] = useState([]);
  const [knowledge, setKnowledge] = useState(null);
  const [loading, setLoading] = useState(true);
  const [newTask, setNewTask] = useState({ title: '', description: '' });

  const loadData = useCallback(async () => {
    try {
      const uni = await base44.entities.University.get(id);
      if (!uni) { setNotFound(true); return; }
      setUniversity(uni);

      const [allTasks, essays, knw] = await Promise.all([
        base44.entities.RoadmapTask.filter({ university_id: id }),
        base44.entities.Essay.list(),
        base44.entities.CollegeKnowledge.list(),
      ]);

      setTasks(allTasks.sort((a, b) => (a.order || 0) - (b.order || 0)));
      setAllEssays(essays);
      setKnowledge(
        knw.find((k) => normalizeUniversityName(k.university_name) === normalizeUniversityName(uni.name)) || null,
      );
    } catch (e) {
      console.error(e);
      toast.error('Could not load this university', { description: e.message });
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { loadData(); }, [loadData]);

  const platform = useMemo(() => getUniversityPlatform(university), [university]);
  const essays = useMemo(
    () => (university ? essaysApplicableToUniversity(allEssays, university) : []),
    [allEssays, university],
  );
  const sharedEssays = essays.filter(isSharedEssay);
  const missingShared = useMemo(
    () => (university ? buildSharedEssayPlan(platform, allEssays) : []),
    [allEssays, platform, university],
  );

  const toggleTask = async (task) => {
    const next = !task.completed;
    setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, completed: next } : t)));
    try {
      await base44.entities.RoadmapTask.update(task.id, { completed: next });
    } catch (e) {
      setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, completed: !next } : t)));
      toast.error('Could not update that task', { description: e.message });
    }
  };

  const addTask = async () => {
    if (!newTask.title) return;
    try {
      const maxOrder = tasks.length ? Math.max(...tasks.map((t) => t.order || 0)) : 0;
      await base44.entities.RoadmapTask.create({
        university_id: id,
        title: newTask.title,
        description: newTask.description,
        category: 'application_platform',
        completed: false,
        order: maxOrder + 1,
      });
      setNewTask({ title: '', description: '' });
      await loadData();
    } catch (e) {
      toast.error('Could not add that task', { description: e.message });
    }
  };

  const removeTask = async (taskId) => {
    try {
      await base44.entities.RoadmapTask.delete(taskId);
      setTasks((prev) => prev.filter((t) => t.id !== taskId));
    } catch (e) {
      toast.error('Could not delete that task', { description: e.message });
    }
  };

  const updateStatus = async (status) => {
    try {
      const updated = await base44.entities.University.update(id, { status });
      setUniversity(updated);
    } catch (e) {
      toast.error('Could not change the status', { description: e.message });
    }
  };

  const deleteEssay = async (essayId) => {
    if (!window.confirm('Delete this essay?')) return;
    try {
      await base44.entities.Essay.delete(essayId);
      setAllEssays((prev) => prev.filter((e) => e.id !== essayId));
    } catch (e) {
      toast.error('Could not delete that essay', { description: e.message });
    }
  };

  const addSharedEssays = async () => {
    try {
      for (const d of missingShared) {
        await base44.entities.Essay.create({
          title: d.title,
          type: d.type,
          prompt: d.prompt,
          word_limit: Number(d.word_limit) || 650,
          content: '',
          status: 'not_started',
          scope: 'common',
          application_platform: d.application_platform,
          limit_unit: d.limit_unit || 'words',
        });
      }
      await loadData();
      toast.success(`${missingShared.length} shared essay${missingShared.length > 1 ? 's' : ''} created`, {
        description: 'They apply to every university on this platform — write each one once.',
      });
    } catch (e) {
      toast.error('Could not create the shared essays', { description: e.message });
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

  const completedTasks = tasks.filter((t) => t.completed).length;
  const progress = tasks.length > 0 ? Math.round((completedTasks / tasks.length) * 100) : 0;
  const groupedTasks = categoryOrder
    .filter((cat) => tasks.some((t) => t.category === cat))
    .map((cat) => ({ category: cat, tasks: tasks.filter((t) => t.category === cat) }));
  const daysLeft = daysUntil(university.deadline);
  const platformInfo = PLATFORMS[platform];

  return (
    <div className="space-y-6">
      <Link to="/universities" className="inline-flex items-center gap-1.5 text-sm text-foreground/40 hover:text-foreground transition">
        <ArrowLeft className="w-4 h-4" />
        All Universities
      </Link>

      <div className="bg-card border border-border rounded-xl p-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="min-w-0">
            <h1 className="font-display text-2xl font-semibold tracking-tight">{university.name}</h1>
            {university.major && <p className="text-foreground/50 mt-1">{university.major}</p>}
            <div className="flex items-center gap-4 mt-3 text-sm text-foreground/40 flex-wrap">
              <span className="flex items-center gap-1.5"><MapPin className="w-3.5 h-3.5" />{university.country}</span>
              {platformInfo && (
                <Badge variant="outline" className="gap-1">
                  <Globe className="w-2.5 h-2.5" />{platformInfo.label}
                </Badge>
              )}
              {university.application_type && <span>{university.application_type}</span>}
              {university.deadline && (
                <span className="flex items-center gap-1.5">
                  <Calendar className="w-3.5 h-3.5" />
                  {new Date(university.deadline).toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}
                  {daysLeft !== null && daysLeft >= 0 && (
                    <span className={daysLeft < 30 ? 'text-destructive' : 'text-foreground/30'}>· {daysLeft} days left</span>
                  )}
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Link to={`/universities/${id}/review`}>
              <Button variant="outline" size="sm">
                <ClipboardCheck className="w-4 h-4 mr-1.5" />
                Application Review
              </Button>
            </Link>
            <Select value={university.status} onValueChange={updateStatus}>
              <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
              <SelectContent>
                {statusOptions.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="mt-5">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-foreground/50">Application Progress</span>
            <span className="font-display text-lg font-semibold text-accent">{progress}%</span>
          </div>
          <div className="h-2 bg-muted rounded-full overflow-hidden">
            <div className="h-full bg-accent rounded-full transition-all duration-500" style={{ width: `${progress}%` }} />
          </div>
          <p className="text-xs text-foreground/40 mt-1.5">{completedTasks} of {tasks.length} tasks completed</p>
        </div>
      </div>

      {!knowledge && (
        <div className="flex items-start gap-3 p-4 rounded-xl bg-amber-50 border border-amber-200">
          <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm font-medium text-amber-800">No research for {university.name} yet</p>
            <p className="text-sm text-amber-700/80 mt-0.5">
              The essay writer and the application review both work far better with a research report — deadlines,
              requirements, and exactly what each prompt is testing.
            </p>
            <Link to="/knowledge-base">
              <Button size="sm" variant="outline" className="mt-2.5 border-amber-300">
                <Library className="w-3.5 h-3.5 mr-1.5" /> Research in Knowledge Base
              </Button>
            </Link>
          </div>
        </div>
      )}

      <Tabs defaultValue="roadmap">
        <TabsList>
          <TabsTrigger value="roadmap">Roadmap</TabsTrigger>
          <TabsTrigger value="essays">Essays ({essays.length})</TabsTrigger>
          <TabsTrigger value="how">How this works</TabsTrigger>
          <TabsTrigger value="notes">Notes</TabsTrigger>
        </TabsList>

        <TabsContent value="roadmap" className="space-y-5 mt-4">
          {groupedTasks.map((group) => (
            <div key={group.category} className="bg-card border border-border rounded-xl overflow-hidden">
              <div className="px-5 py-3 border-b border-border bg-muted/30">
                <h3 className="font-medium text-sm">{categoryLabels[group.category] || group.category}</h3>
              </div>
              <div className="divide-y divide-border">
                {group.tasks.map((task) => (
                  <div key={task.id} className="flex items-start gap-3 px-5 py-3.5 group">
                    <button onClick={() => toggleTask(task)} className="mt-0.5 shrink-0">
                      {task.completed
                        ? <CheckCircle2 className="w-5 h-5 text-accent" />
                        : <Circle className="w-5 h-5 text-foreground/20 hover:text-foreground/40 transition" />}
                    </button>
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-medium ${task.completed ? 'text-foreground/40 line-through' : ''}`}>{task.title}</p>
                      {task.description && (
                        <p className={`text-xs text-foreground/40 mt-0.5 ${task.completed ? 'line-through' : ''}`}>{task.description}</p>
                      )}
                    </div>
                    <button
                      onClick={() => removeTask(task.id)}
                      className="opacity-0 group-hover:opacity-100 p-1 rounded text-foreground/20 hover:text-destructive transition shrink-0"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ))}

          <div className="bg-card border border-border rounded-xl p-5">
            <h3 className="font-medium text-sm mb-3">Add Custom Task</h3>
            <div className="flex gap-2">
              <input
                value={newTask.title}
                onChange={(e) => setNewTask({ ...newTask, title: e.target.value })}
                placeholder="Task title..."
                className="flex-1 rounded-lg border border-input bg-background px-3.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-ring transition"
                onKeyDown={(e) => e.key === 'Enter' && addTask()}
              />
              <Button onClick={addTask} disabled={!newTask.title}>
                <Plus className="w-4 h-4 mr-1" /> Add
              </Button>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="essays" className="space-y-3 mt-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <p className="text-sm text-foreground/50">
              {essays.length} essay{essays.length !== 1 ? 's' : ''} apply to {university.name}
            </p>
            <Link to={`/essay-builder?university=${id}`}>
              <Button><Plus className="w-4 h-4 mr-2" /> New Essay</Button>
            </Link>
          </div>

          {missingShared.length > 0 && (
            <div className="flex items-start gap-3 p-4 rounded-xl bg-accent/5 border border-accent/20">
              <Library className="w-4 h-4 text-accent shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-sm font-medium">Shared writing is missing</p>
                <p className="text-xs text-foreground/50 mt-0.5">{platformInfo?.sharedNote}</p>
                <Button size="sm" className="mt-2.5" onClick={addSharedEssays}>
                  <Plus className="w-3.5 h-3.5 mr-1.5" /> Create {missingShared.length} shared essay{missingShared.length > 1 ? 's' : ''}
                </Button>
              </div>
            </div>
          )}

          {essays.length === 0 ? (
            <div className="bg-card border border-border rounded-xl p-12 text-center">
              <PenLine className="w-8 h-8 text-foreground/20 mx-auto mb-3" />
              <p className="text-sm text-foreground/40 mb-4">No essays apply to this university yet.</p>
              <Link to={`/essay-builder?university=${id}`}><Button>Start Writing</Button></Link>
            </div>
          ) : (
            <div className="space-y-2">
              {[
                { label: `Shared with every ${platformInfo?.short} university`, items: sharedEssays },
                { label: university.name, items: essays.filter((e) => !isSharedEssay(e)) },
              ].filter((g) => g.items.length > 0).map((group) => (
                <div key={group.label}>
                  <p className="text-xs font-medium text-foreground/40 px-1 pb-1.5">{group.label}</p>
                  <div className="space-y-2">
                    {group.items.map((essay) => {
                      const u = limitUnitFor(essay);
                      const n = measureEssay(essay.content || '', u);
                      return (
                        <div key={essay.id} className="bg-card border border-border rounded-xl p-5 group">
                          <div className="flex items-start justify-between gap-3">
                            <Link to={`/essay-builder?university=${id}&essay=${essay.id}`} className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1 flex-wrap">
                                <FileText className="w-4 h-4 text-foreground/30" />
                                <h3 className="font-medium text-sm">{essay.title}</h3>
                                {isSharedEssay(essay) && (
                                  <Badge variant="outline" className="h-5 px-1.5 text-[10px] text-accent border-accent/40">shared</Badge>
                                )}
                              </div>
                              <p className="text-xs text-foreground/40 line-clamp-2">{essay.prompt || 'No prompt set'}</p>
                              <div className="flex items-center gap-2 mt-2 text-xs text-foreground/30 flex-wrap">
                                <span className="capitalize">{(essay.status || 'not_started').replace(/_/g, ' ')}</span>
                                <span>·</span>
                                <span>{essay.word_limit || '—'} {u === 'characters' ? 'chars' : 'words'}</span>
                                {essay.content && (
                                  <span className={n > (essay.word_limit || Infinity) ? 'text-destructive' : ''}>
                                    · {n} written
                                  </span>
                                )}
                              </div>
                            </Link>
                            <button
                              onClick={() => deleteEssay(essay.id)}
                              className="opacity-0 group-hover:opacity-100 p-1.5 rounded text-foreground/20 hover:text-destructive transition shrink-0"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="how" className="mt-4">
          <div className="bg-card border border-border rounded-xl p-5 space-y-4">
            <div className="flex items-center gap-2">
              <Info className="w-4 h-4 text-foreground/40" />
              <h3 className="font-medium text-sm">How {university.name} works</h3>
            </div>
            <p className="text-sm text-foreground/60">{PLATFORM_REQUIREMENTS[platform]?.summary}</p>
            {platformInfo?.sharedNote && (
              <p className="text-sm text-foreground/60 flex items-start gap-2">
                <Library className="w-4 h-4 text-accent shrink-0 mt-0.5" />
                {platformInfo.sharedNote}
              </p>
            )}
            <div>
              <h4 className="text-xs font-medium text-foreground/50 mb-1.5">What the committee is reading for</h4>
              <ul className="space-y-1.5">
                {(PLATFORM_REQUIREMENTS[platform]?.steps || []).map((step, i) => (
                  <li key={i} className="text-sm text-foreground/60 flex gap-2.5">
                    <span className="text-accent shrink-0">{i + 1}.</span>{step}
                  </li>
                ))}
              </ul>
            </div>
            <p className="text-xs text-foreground/40 leading-relaxed border-t border-border pt-3">
              {PLATFORM_REQUIREMENTS[platform]?.reviewFocus}
            </p>
          </div>
        </TabsContent>

        <TabsContent value="notes" className="mt-4">
          <div className="bg-card border border-border rounded-xl p-5">
            <textarea
              value={university.notes || ''}
              onChange={(e) => setUniversity({ ...university, notes: e.target.value })}
              onBlur={async () => {
                try {
                  await base44.entities.University.update(id, { notes: university.notes });
                  toast.success('Notes saved');
                } catch (e) {
                  toast.error('Could not save notes', { description: e.message });
                }
              }}
              placeholder="Notes about this university, strategy, key points to remember…"
              rows={10}
              className="w-full rounded-lg border border-input bg-background px-3.5 py-2.5 text-sm resize-y focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-ring transition placeholder:text-foreground/25"
            />
            <p className="text-xs text-foreground/30 mt-2">Changes save when you click away.</p>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}