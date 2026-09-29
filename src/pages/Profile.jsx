import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Save, Globe, GraduationCap, ClipboardList, Award, DollarSign, FileText, Info, Briefcase } from 'lucide-react';
import ActivitiesEditor from '@/components/profile/ActivitiesEditor';
import HonorsEditor from '@/components/profile/HonorsEditor';

function SectionCard({ icon: Icon, title, description, children }) {
  return (
    <div className="bg-card border border-border rounded-xl p-5">
      <div className="flex items-center gap-2.5 mb-4">
        <div className="w-8 h-8 rounded-lg bg-foreground/5 flex items-center justify-center">
          <Icon className="w-4 h-4 text-foreground/50" />
        </div>
        <div>
          <h2 className="font-medium text-sm">{title}</h2>
          {description && <p className="text-xs text-foreground/40 mt-0.5">{description}</p>}
        </div>
      </div>
      {children}
    </div>
  );
}

function Field({ label, hint, children, className }) {
  return (
    <div className={className}>
      <div className="flex items-center gap-1.5 mb-1.5">
        <Label className="text-xs font-medium text-foreground/60">{label}</Label>
        {hint && <Info className="w-3 h-3 text-foreground/25" />}
      </div>
      {children}
    </div>
  );
}

export default function Profile() {
  const [profile, setProfile] = useState(null);
  const [formData, setFormData] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const profiles = await base44.entities.Profile.list();
        if (profiles.length > 0) {
          setProfile(profiles[0]);
          setFormData(profiles[0]);
        } else {
          setFormData({ requires_financial_aid: true, school_system: 'Japanese Public' });
        }
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const set = (key, value) => setFormData((prev) => ({ ...prev, [key]: value }));

  const handleSave = async () => {
    setSaving(true);
    try {
      if (profile) {
        const updated = await base44.entities.Profile.update(profile.id, formData);
        setProfile(updated);
      } else {
        const created = await base44.entities.Profile.create(formData);
        setProfile(created);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setSaving(false);
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
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-semibold tracking-tight">My Profile</h1>
          <p className="text-foreground/50 mt-1.5">Your background fuels every essay, strategy, and research.</p>
        </div>
        <Button onClick={handleSave} disabled={saving} className="shrink-0">
          <Save className="w-4 h-4 mr-2" />
          {saving ? 'Saving...' : 'Save'}
        </Button>
      </div>

      <SectionCard icon={Globe} title="Personal Background" description="Who you are and where you're coming from">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Nationality">
            <Input value={formData.nationality || ''} onChange={(e) => set('nationality', e.target.value)} placeholder="e.g. Japanese" />
          </Field>
          <Field label="School System">
            <Select value={formData.school_system || 'Japanese Public'} onValueChange={(v) => set('school_system', v)}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="Japanese Public">Japanese Public</SelectItem>
                <SelectItem value="Japanese Private">Japanese Private</SelectItem>
                <SelectItem value="US">US System</SelectItem>
                <SelectItem value="UK">UK System</SelectItem>
                <SelectItem value="IB World School">IB World School</SelectItem>
                <SelectItem value="Other">Other</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Graduation Year">
            <Input value={formData.graduation_year || ''} onChange={(e) => set('graduation_year', e.target.value)} placeholder="e.g. 2027" />
          </Field>
        </div>
        <div className="mt-4">
          <Field label="Background Summary" hint="Your story, identity, context">
            <Textarea value={formData.background_summary || ''} onChange={(e) => set('background_summary', e.target.value)} rows={4} placeholder="Who you are, your story, what shaped you..." />
          </Field>
        </div>
        <div className="mt-4">
          <Field label="Education System Notes" hint="Explain your school system for US/UK context">
            <Textarea value={formData.education_notes || ''} onChange={(e) => set('education_notes', e.target.value)} rows={3} placeholder="Explain your school system — course structure, grading, differences from US/UK..." />
          </Field>
        </div>
      </SectionCard>

      <SectionCard icon={GraduationCap} title="Academic Record" description="IB grades and GPA">
        <div className="grid grid-cols-2 gap-4">
          <Field label="IB Predicted Score">
            <Input type="number" value={formData.ib_predicted_score ?? ''} onChange={(e) => set('ib_predicted_score', e.target.value ? parseFloat(e.target.value) : null)} placeholder="e.g. 43" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="GPA">
              <Input value={formData.gpa_value || ''} onChange={(e) => set('gpa_value', e.target.value)} placeholder="e.g. 5.0" />
            </Field>
            <Field label="Scale">
              <Input value={formData.gpa_scale || ''} onChange={(e) => set('gpa_scale', e.target.value)} placeholder="e.g. 5.0" />
            </Field>
          </div>
        </div>
        <div className="mt-4">
          <Field label="IB Subjects" hint="List all HL and SL subjects">
            <Textarea value={formData.ib_subjects || ''} onChange={(e) => set('ib_subjects', e.target.value)} rows={3} placeholder="e.g. Japanese A: Literature SL, English B HL, Physics HL, Chemistry HL, Math AA HL..." />
          </Field>
        </div>
      </SectionCard>

      <SectionCard icon={ClipboardList} title="Standardized Tests" description="SAT, IELTS, and other scores">
        <div className="mb-4">
          <Label className="text-xs font-medium text-foreground/60 mb-2 block">SAT Scores</Label>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Math">
              <Input type="number" value={formData.sat_math ?? ''} onChange={(e) => set('sat_math', e.target.value ? parseInt(e.target.value) : null)} placeholder="0-800" />
            </Field>
            <Field label="EBRW">
              <Input type="number" value={formData.sat_ebrw ?? ''} onChange={(e) => set('sat_ebrw', e.target.value ? parseInt(e.target.value) : null)} placeholder="0-800" />
            </Field>
          </div>
        </div>
        <div className="mb-4">
          <Label className="text-xs font-medium text-foreground/60 mb-2 block">IELTS Scores (highest by component)</Label>
          <div className="grid grid-cols-4 gap-3">
            <Field label="Listening">
              <Input type="number" step="0.5" value={formData.ielts_listening ?? ''} onChange={(e) => set('ielts_listening', e.target.value ? parseFloat(e.target.value) : null)} placeholder="0-9" />
            </Field>
            <Field label="Reading">
              <Input type="number" step="0.5" value={formData.ielts_reading ?? ''} onChange={(e) => set('ielts_reading', e.target.value ? parseFloat(e.target.value) : null)} placeholder="0-9" />
            </Field>
            <Field label="Writing">
              <Input type="number" step="0.5" value={formData.ielts_writing ?? ''} onChange={(e) => set('ielts_writing', e.target.value ? parseFloat(e.target.value) : null)} placeholder="0-9" />
            </Field>
            <Field label="Speaking">
              <Input type="number" step="0.5" value={formData.ielts_speaking ?? ''} onChange={(e) => set('ielts_speaking', e.target.value ? parseFloat(e.target.value) : null)} placeholder="0-9" />
            </Field>
          </div>
        </div>
        <Field label="Additional Test Info" hint="ESAT, AP, test dates, retake plans, etc.">
          <Textarea value={formData.additional_test_info || ''} onChange={(e) => set('additional_test_info', e.target.value)} rows={3} placeholder="ESAT dates, retake plans, other test details..." />
        </Field>
      </SectionCard>

      <SectionCard icon={Briefcase} title="Activities" description="Common App format — up to 10 activities">
        <ActivitiesEditor value={formData.activities || []} onChange={(val) => set('activities', val)} />
      </SectionCard>

      <SectionCard icon={Award} title="Honors" description="Common App format — up to 5 honors">
        <HonorsEditor value={formData.honors || []} onChange={(val) => set('honors', val)} />
      </SectionCard>

      <SectionCard icon={DollarSign} title="Financial Aid" description="This affects university research and essay strategy">
        <div className="flex items-center justify-between p-3 rounded-lg bg-muted/40">
          <div>
            <Label className="text-sm font-medium cursor-pointer">I require financial aid</Label>
            <p className="text-xs text-foreground/40 mt-0.5">If off, research will analyze the advantage of applying as a full-pay student</p>
          </div>
          <Switch checked={formData.requires_financial_aid ?? true} onCheckedChange={(v) => set('requires_financial_aid', v)} />
        </div>
        {formData.requires_financial_aid && (
          <div className="mt-4">
            <Field label="Financial Aid Notes">
              <Textarea value={formData.financial_aid_notes || ''} onChange={(e) => set('financial_aid_notes', e.target.value)} rows={2} placeholder="Any specific financial aid context or constraints..." />
            </Field>
          </div>
        )}
      </SectionCard>

      <SectionCard icon={FileText} title="Additional Context" description="Anything else that shapes your application">
        <Textarea value={formData.additional_context || ''} onChange={(e) => set('additional_context', e.target.value)} rows={4} placeholder="Application strategy, special circumstances, anything else..." />
      </SectionCard>

      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={saving}>
          <Save className="w-4 h-4 mr-2" />
          {saving ? 'Saving...' : 'Save Profile'}
        </Button>
      </div>
    </div>
  );
}