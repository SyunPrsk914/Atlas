import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ArrowLeft, CheckCircle2, Circle, Plus, PenLine, Calendar, MapPin, Trash2, FileText, ClipboardCheck } from 'lucide-react';
import { essaysApplicableToUniversity } from '@/lib/essayScope';

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
  const navigate = useNavigate();
  const [university, setUniversity] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [essays, setEssays] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newTask, setNewTask] = useState({ title: '', description: '' });

  useEffect(() => {
    loadData();
  }, [id]);

  const loadData = async () => {
    try {
      const uni = await base44.entities.University.get(id);
      setUniversity(uni);
      const [allTasks, allEssays] = await Promise.all([
        base44.entities.RoadmapTask.filter({ university_id: id }),
        base44.entities.Essay.list(),
      ]);
      setTasks(allTasks.sort((a, b) => (a.order || 0) - (b.order || 0)));
      setEssays(essaysApplicableToUniversity(allEssays, uni));
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const toggleTask = async (task) => {
    try {
      await base44.entities.RoadmapTask.update(task.id, { completed: !task.completed });
      setTasks(tasks.map((t) => (t.id === task.id ? { ...t, completed: !t.completed } : t)));
    } catch (e) {
      console.error(e);
    }
  };

  const addTask = async () => {
    if (!newTask.title) return;
    try {
      const maxOrder = Math.max(0, ...tasks.map((t) => t.order || 0));
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
      console.error(e);
    }
  };

  const removeTask = async (taskId) => {
    try {
      await base44.entities.RoadmapTask.delete(taskId);
      setTasks(tasks.filter((t) => t.id !== taskId));
    } catch (e) {
      console.error(e);
    }
  };

  const updateStatus = async (status) => {
    try {
      const updated = await base44.entities.University.update(id, { status });
      setUniversity(updated);
    } catch (e) {
      console.error(e);
    }
  };

  const deleteEssay = async (essayId) => {
    if (!confirm('Delete this essay?')) return;
    try {
      await base44.entities.Essay.delete(essayId);
      setEssays(essays.filter((e) => e.id !== essayId));
    } catch (e) {
      console.error(e);
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

  const completedTasks = tasks.filter((t) => t.completed).length;
  const progress = tasks.length > 0 ? Math.round((completedTasks / tasks.length) * 100) : 0;
  const groupedTasks = categoryOrder
    .filter((cat) => tasks.some((t) => t.category === cat))
    .map((cat) => ({ category: cat, tasks: tasks.filter((t) => t.category === cat) }));

  const daysLeft = university.deadline ? Math.ceil((new Date(university.deadline) - new Date()) / (1000 * 60 * 60 * 24)) : null;

  return (
    <div className="space-y-6">
      <Link to="/universities" className="inline-flex items-center gap-1.5 text-sm text-foreground/40 hover:text-foreground transition">
        <ArrowLeft className="w-4 h-4" />
        All Universities
      </Link>

      <div className="bg-card border border-border rounded-xl p-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="font-display text-2xl font-semibold tracking-tight">{university.name}</h1>
            {university.major && <p className="text-foreground/50 mt-1">{university.major}</p>}
            <div className="flex items-center gap-4 mt-3 text-sm text-foreground/40">
              <span className="flex items-center gap-1.5"><MapPin className="w-3.5 h-3.5" />{university.country}</span>
              {university.application_type && <span>{university.application_type}</span>}
              {university.deadline && (
                <span className="flex items-center gap-1.5">
                  <Calendar className="w-3.5 h-3.5" />
                  {new Date(university.deadline).toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}
                  {daysLeft !== null && daysLeft >= 0 && <span className="text-foreground/30">· {daysLeft} days left</span>}
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
              <SelectTrigger className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {statusOptions.map((s) => (
                  <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                ))}
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

      <Tabs defaultValue="roadmap">
        <TabsList>
          <TabsTrigger value="roadmap">Roadmap</TabsTrigger>
          <TabsTrigger value="essays">Essays ({essays.length})</TabsTrigger>
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
                      {task.completed ? (
                        <CheckCircle2 className="w-5 h-5 text-accent" />
                      ) : (
                        <Circle className="w-5 h-5 text-foreground/20 hover:text-foreground/40 transition" />
                      )}
                    </button>
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-medium ${task.completed ? 'text-foreground/40 line-through' : ''}`}>{task.title}</p>
                      {task.description && <p className={`text-xs text-foreground/40 mt-0.5 ${task.completed ? 'line-through' : ''}`}>{task.description}</p>}
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
                <Plus className="w-4 h-4 mr-1" />
                Add
              </Button>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="essays" className="space-y-3 mt-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-foreground/50">{essays.length} essay{essays.length !== 1 ? 's' : ''} applicable to this university</p>
            <Link to={`/essay-builder?university=${id}`}>
              <Button>
                <Plus className="w-4 h-4 mr-2" />
                New Essay
              </Button>
            </Link>
          </div>
          {essays.length === 0 ? (
            <div className="bg-card border border-border rounded-xl p-12 text-center">
              <PenLine className="w-8 h-8 text-foreground/20 mx-auto mb-3" />
              <p className="text-sm text-foreground/40 mb-4">No essays yet for this university.</p>
              <Link to={`/essay-builder?university=${id}`}>
                <Button>Start Writing</Button>
              </Link>
            </div>
          ) : (
            essays.map((essay) => (
              <div key={essay.id} className="bg-card border border-border rounded-xl p-5 group">
                <div className="flex items-start justify-between gap-3">
                  <Link to={`/essay-builder?university=${id}&essay=${essay.id}`} className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <FileText className="w-4 h-4 text-foreground/30" />
                      <h3 className="font-medium text-sm">{essay.title}</h3>
                      {essay.scope === 'common' && <span className="text-xs text-accent bg-accent/10 px-2 py-0.5 rounded">Common App</span>}
                    </div>
                    <p className="text-xs text-foreground/40 line-clamp-2">{essay.prompt || 'No prompt set'}</p>
                    <div className="flex items-center gap-3 mt-2 text-xs text-foreground/30">
                      <span className="capitalize">{essay.status.replace(/_/g, ' ')}</span>
                      <span>·</span>
                      <span>{essay.word_limit || '—'} words</span>
                      {essay.content && <span>· {essay.content.trim().split(/\s+/).length} written</span>}
                    </div>
                  </Link>
                  <button
                    onClick={() => deleteEssay(essay.id)}
                    className="opacity-0 group-hover:opacity-100 p-1.5 rounded text-foreground/20 hover:text-destructive transition"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))
          )}
        </TabsContent>

        <TabsContent value="notes" className="mt-4">
          <div className="bg-card border border-border rounded-xl p-5">
            <textarea
              value={university.notes || ''}
              onChange={(e) => setUniversity({ ...university, notes: e.target.value })}
              onBlur={() => base44.entities.University.update(id, { notes: university.notes })}
              placeholder="Notes about this university, strategy, key points to remember..."
              rows={10}
              className="w-full rounded-lg border border-input bg-background px-3.5 py-2.5 text-sm resize-y focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-ring transition placeholder:text-foreground/25"
            />
            <p className="text-xs text-foreground/30 mt-2">Changes save automatically when you click away.</p>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}