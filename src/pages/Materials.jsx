import { useState, useEffect, useRef } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Plus, Trash2, FileText, Link as LinkIcon, Upload, File, Award, StickyNote, Loader2, Pencil, X } from 'lucide-react';

const materialTypes = [
  { value: 'document', label: 'Document', icon: File },
  { value: 'link', label: 'Link / Website', icon: LinkIcon },
  { value: 'essay', label: 'Past Essay', icon: FileText },
  { value: 'resume', label: 'Resume / CV', icon: FileText },
  { value: 'transcript', label: 'Transcript', icon: File },
  { value: 'award', label: 'Award / Certificate', icon: Award },
  { value: 'note', label: 'Note / Context', icon: StickyNote },
  { value: 'other', label: 'Other', icon: File },
];

const typeIcon = (type) => materialTypes.find((t) => t.value === type)?.icon || File;

export default function Materials() {
  const [materials, setMaterials] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingMaterial, setEditingMaterial] = useState(null);
  const [form, setForm] = useState({ title: '', type: 'document', content: '', link_url: '', notes: '' });
  const [file, setFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef(null);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const mats = await base44.entities.Material.list();
      setMaterials(mats);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const openAdd = () => {
    setEditingMaterial(null);
    setForm({ title: '', type: 'document', content: '', link_url: '', notes: '' });
    setFile(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
    setDialogOpen(true);
  };

  const openEdit = (mat) => {
    setEditingMaterial(mat);
    setForm({ title: mat.title, type: mat.type, content: mat.content || '', link_url: mat.link_url || '', notes: mat.notes || '' });
    setFile(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
    setDialogOpen(true);
  };

  const handleFileChange = (e) => {
    setFile(e.target.files[0]);
  };

  const handleSave = async () => {
    if (!form.title) return;
    setSaving(true);
    try {
      let file_url = editingMaterial?.file_url || '';
      if (file) {
        const result = await base44.integrations.Core.UploadPublicFile({ file });
        file_url = result.file_url;
      }
      if (editingMaterial) {
        const updated = await base44.entities.Material.update(editingMaterial.id, {
          title: form.title,
          type: form.type,
          content: form.content,
          link_url: form.link_url,
          file_url,
          notes: form.notes,
        });
        setMaterials(materials.map((m) => (m.id === updated.id ? updated : m)));
      } else {
        const created = await base44.entities.Material.create({
          title: form.title,
          type: form.type,
          content: form.content,
          link_url: form.link_url,
          file_url,
          notes: form.notes,
        });
        setMaterials([...materials, created]);
      }
      setDialogOpen(false);
    } catch (e) {
      console.error(e);
      alert('Failed to save material. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async (mat) => {
    if (!confirm(`Remove "${mat.title}"?`)) return;
    try {
      await base44.entities.Material.delete(mat.id);
      setMaterials(materials.filter((m) => m.id !== mat.id));
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

  const grouped = materialTypes
    .map((t) => ({ ...t, items: materials.filter((m) => m.type === t.value) }))
    .filter((g) => g.items.length > 0);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-semibold tracking-tight">Materials</h1>
          <p className="text-foreground/50 mt-1.5">Upload documents, links, past essays, and context. The AI uses these to build your essays.</p>
        </div>
        <Button onClick={openAdd}>
          <Plus className="w-4 h-4 mr-2" />
          Add Material
        </Button>
      </div>

      {materials.length === 0 ? (
        <div className="bg-card border border-border rounded-xl p-16 text-center">
          <FileText className="w-10 h-10 text-foreground/20 mx-auto mb-4" />
          <h3 className="font-display text-lg font-medium mb-1">No materials yet</h3>
          <p className="text-sm text-foreground/40 mb-5">Upload documents, paste links, or add context to fuel your essays.</p>
          <Button onClick={openAdd}>
            <Plus className="w-4 h-4 mr-2" />
            Add Material
          </Button>
        </div>
      ) : (
        <div className="space-y-6">
          {grouped.map((group) => (
            <div key={group.value}>
              <h2 className="text-sm font-medium text-foreground/50 mb-2.5 flex items-center gap-2">
                <group.icon className="w-4 h-4" />
                {group.label} ({group.items.length})
              </h2>
              <div className="space-y-2">
                {group.items.map((mat) => {
                  const Icon = typeIcon(mat.type);
                  return (
                    <div key={mat.id} className="group bg-card border border-border rounded-xl p-4 flex items-start gap-3 hover:border-foreground/15 transition">
                      <div className="w-9 h-9 rounded-lg bg-foreground/5 flex items-center justify-center shrink-0">
                        <Icon className="w-4 h-4 text-foreground/50" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <h3 className="font-medium text-sm">{mat.title}</h3>
                        {mat.content && <p className="text-xs text-foreground/40 mt-0.5 line-clamp-2">{mat.content}</p>}
                        {mat.link_url && (
                          <a href={mat.link_url} target="_blank" rel="noopener noreferrer" className="text-xs text-accent hover:underline mt-0.5 inline-flex items-center gap-1">
                            <LinkIcon className="w-3 h-3" />
                            {mat.link_url}
                          </a>
                        )}
                        {mat.file_url && (
                          <a href={mat.file_url} target="_blank" rel="noopener noreferrer" className="text-xs text-accent hover:underline mt-0.5 inline-flex items-center gap-1">
                            <File className="w-3 h-3" />
                            View file
                          </a>
                        )}
                        {mat.notes && <p className="text-xs text-foreground/30 mt-1">{mat.notes}</p>}
                      </div>
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition shrink-0">
                        <button onClick={() => openEdit(mat)} className="p-1.5 rounded text-foreground/30 hover:text-foreground hover:bg-muted transition">
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => handleRemove(mat)} className="p-1.5 rounded text-foreground/30 hover:text-destructive hover:bg-destructive/5 transition">
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

      {/* Add/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="font-display">{editingMaterial ? 'Edit Material' : 'Add Material'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label className="block text-xs font-medium text-foreground/50 mb-1.5">Title</Label>
              <Input
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                placeholder="Material title..."
              />
            </div>
            <div>
              <Label className="block text-xs font-medium text-foreground/50 mb-1.5">Type</Label>
              <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v })}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {materialTypes.map((t) => (
                    <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="block text-xs font-medium text-foreground/50 mb-1.5">Upload File (optional)</Label>
              <input
                ref={fileInputRef}
                type="file"
                onChange={handleFileChange}
                className="w-full text-sm text-foreground/50 file:mr-3 file:py-2 file:px-3.5 file:rounded-lg file:border-0 file:bg-muted file:text-foreground file:font-medium file:cursor-pointer hover:file:bg-foreground/10 transition"
              />
              {file && <p className="text-xs text-foreground/40 mt-1.5">New file: {file.name}</p>}
              {editingMaterial?.file_url && !file && <p className="text-xs text-foreground/30 mt-1.5">Current file kept. Upload to replace.</p>}
            </div>
            <div>
              <Label className="block text-xs font-medium text-foreground/50 mb-1.5">Link URL</Label>
              <Input
                value={form.link_url}
                onChange={(e) => setForm({ ...form, link_url: e.target.value })}
                placeholder="https://..."
              />
            </div>
            <div>
              <Label className="block text-xs font-medium text-foreground/50 mb-1.5">Content / Text</Label>
              <Textarea
                value={form.content}
                onChange={(e) => setForm({ ...form, content: e.target.value })}
                placeholder="Paste content here, or describe what this material contains..."
                rows={4}
              />
            </div>
            <div>
              <Label className="block text-xs font-medium text-foreground/50 mb-1.5">Notes</Label>
              <Input
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                placeholder="Any notes about this material..."
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving || !form.title}>
              {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Upload className="w-4 h-4 mr-2" />}
              {saving ? 'Saving...' : editingMaterial ? 'Update' : 'Add Material'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}