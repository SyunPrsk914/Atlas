import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, Trash2, ArrowRight, GraduationCap, Calendar, MapPin } from 'lucide-react';
import { roadmapTemplates } from '@/lib/roadmapTemplate';

const statusColors = {
  researching: 'bg-foreground/10 text-foreground/50',
  in_progress: 'bg-accent/15 text-accent',
  submitted: 'bg-blue-100 text-blue-700',
  decided: 'bg-green-100 text-green-700',
};

const appTypes = {
  US: ['Restrictive Early Action', 'Early Action', 'Early Decision', 'Early Decision II', 'Regular Decision', 'Rolling'],
  UK: ['UCAS (Oct 15)', 'UCAS (Jan)'],
};

export default function Universities() {
  const [universities, setUniversities] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState({ name: '', country: 'US', major: '', application_type: '', deadline: '', notes: '' });
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [unis, tsk] = await Promise.all([
        base44.entities.University.list(),
        base44.entities.RoadmapTask.list(),
      ]);
      setUniversities(unis);
      setTasks(tsk);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const usCount = universities.filter((u) => u.country === 'US').length;
  const ukCount = universities.filter((u) => u.country === 'UK').length;

  const handleAdd = async () => {
    if (!form.name || !form.country) return;
    if (form.country === 'US' && usCount >= 25) {
      alert('Limit reached: maximum of 25 US universities. Remove one before adding another.');
      return;
    }
    if (form.country === 'UK' && ukCount >= 2) {
      alert('Limit reached: maximum of 2 UK universities. Remove one before adding another.');
      return;
    }
    setAdding(true);
    try {
      const uni = await base44.entities.University.create(form);
      const template = roadmapTemplates[form.country] || roadmapTemplates.US;
      const taskData = template.map((t) => ({
        university_id: uni.id,
        title: t.title,
        description: t.description,
        category: t.category,
        completed: false,
        order: t.order,
      }));
      await base44.entities.RoadmapTask.bulkCreate(taskData);
      setForm({ name: '', country: 'US', major: '', application_type: '', deadline: '', notes: '' });
      setDialogOpen(false);
      await loadData();
    } catch (e) {
      console.error(e);
    } finally {
      setAdding(false);
    }
  };

  const handleRemove = async (uni) => {
    if (!confirm(`Remove ${uni.name}? This will also delete its roadmap tasks and essays.`)) return;
    try {
      await base44.entities.RoadmapTask.deleteMany({ university_id: uni.id });
      await base44.entities.Essay.deleteMany({ university_id: uni.id });
      await base44.entities.University.delete(uni.id);
      await loadData();
    } catch (e) {
      console.error(e);
    }
  };

  const getProgress = (uniId) => {
    const uniTasks = tasks.filter((t) => t.university_id === uniId);
    if (uniTasks.length === 0) return 0;
    return Math.round((uniTasks.filter((t) => t.completed).length / uniTasks.length) * 100);
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
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-semibold tracking-tight">Universities</h1>
          <p className="text-foreground/50 mt-1.5">
            {usCount}/25 US · {ukCount}/2 UK universities
          </p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="w-4 h-4 mr-2" />
              Add University
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="font-display">Add University</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div>
                <label className="block text-sm font-medium mb-1.5">University Name</label>
                <input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="e.g. Stanford University"
                  className="w-full rounded-lg border border-input bg-background px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-ring transition"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1.5">Country</label>
                <Select value={form.country} onValueChange={(v) => setForm({ ...form, country: v, application_type: '' })}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="US">United States</SelectItem>
                    <SelectItem value="UK">United Kingdom</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1.5">Major / Program</label>
                <input
                  value={form.major}
                  onChange={(e) => setForm({ ...form, major: e.target.value })}
                  placeholder="e.g. Aeronautics and Astronautics"
                  className="w-full rounded-lg border border-input bg-background px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-ring transition"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1.5">Application Type</label>
                <Select value={form.application_type} onValueChange={(v) => setForm({ ...form, application_type: v })}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select type..." />
                  </SelectTrigger>
                  <SelectContent>
                    {(appTypes[form.country] || appTypes.US).map((t) => (
                      <SelectItem key={t} value={t}>{t}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1.5">Deadline</label>
                <input
                  type="date"
                  value={form.deadline}
                  onChange={(e) => setForm({ ...form, deadline: e.target.value })}
                  className="w-full rounded-lg border border-input bg-background px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-ring transition"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1.5">Notes</label>
                <textarea
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  placeholder="Any notes about this university..."
                  rows={2}
                  className="w-full rounded-lg border border-input bg-background px-3.5 py-2.5 text-sm resize-y focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-ring transition"
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
              <Button onClick={handleAdd} disabled={adding || !form.name}>
                {adding ? 'Adding...' : 'Add University'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {universities.length === 0 ? (
        <div className="bg-card border border-border rounded-xl p-16 text-center">
          <GraduationCap className="w-10 h-10 text-foreground/20 mx-auto mb-4" />
          <h3 className="font-display text-lg font-medium mb-1">No universities yet</h3>
          <p className="text-sm text-foreground/40 mb-5">Add your first university to start building its roadmap.</p>
          <Button onClick={() => setDialogOpen(true)}>
            <Plus className="w-4 h-4 mr-2" />
            Add University
          </Button>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {universities.map((uni) => {
            const progress = getProgress(uni.id);
            return (
              <div key={uni.id} className="group bg-card border border-border rounded-xl p-5 hover:border-foreground/20 transition-all relative">
                <button
                  onClick={() => handleRemove(uni)}
                  className="absolute top-3 right-3 p-1.5 rounded-md text-foreground/20 hover:text-destructive hover:bg-destructive/5 opacity-0 group-hover:opacity-100 transition"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
                <Link to={`/universities/${uni.id}`} className="block">
                  <div className="flex items-center gap-2 mb-3">
                    <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${statusColors[uni.status] || statusColors.researching}`}>
                      {uni.status.replace('_', ' ')}
                    </span>
                    <span className="text-[11px] text-foreground/30 font-medium">{uni.country}</span>
                  </div>
                  <h3 className="font-display text-lg font-semibold pr-6 leading-tight mb-1">{uni.name}</h3>
                  {uni.major && <p className="text-sm text-foreground/50 mb-3 line-clamp-2">{uni.major}</p>}
                  {uni.application_type && (
                    <div className="flex items-center gap-1.5 text-xs text-foreground/40 mb-1">
                      <MapPin className="w-3 h-3" />
                      {uni.application_type}
                    </div>
                  )}
                  {uni.deadline && (
                    <div className="flex items-center gap-1.5 text-xs text-foreground/40 mb-3">
                      <Calendar className="w-3 h-3" />
                      {new Date(uni.deadline).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                    </div>
                  )}
                  <div className="mt-4">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-xs text-foreground/40">Roadmap</span>
                      <span className="text-xs font-medium">{progress}%</span>
                    </div>
                    <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                      <div className="h-full bg-accent rounded-full transition-all" style={{ width: `${progress}%` }} />
                    </div>
                  </div>
                  <div className="flex items-center gap-1 text-xs text-foreground/30 mt-4 group-hover:text-foreground/60 transition">
                    Open workspace
                    <ArrowRight className="w-3 h-3 group-hover:translate-x-0.5 transition" />
                  </div>
                </Link>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}