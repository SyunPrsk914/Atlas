import { useState, useEffect, useMemo } from 'react';
import { toast } from 'sonner';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Save, GraduationCap, ClipboardList, Award, DollarSign, FileText,
  Info, Briefcase, Database, User, Landmark, Loader2,
} from 'lucide-react';
import ActivitiesEditor from '@/components/profile/ActivitiesEditor';
import HonorsEditor from '@/components/profile/HonorsEditor';
import IbSubjectPicker from '@/components/profile/IbSubjectPicker';
import {
  NATIONALITIES, SCHOOL_SYSTEMS, GPA_SCALES, CITIZENSHIP_STATUSES,
  CURRICULUM_TYPES, FIRST_GENERATION_OPTIONS, TEST_POLICIES, FUNDING_SOURCES,
} from '@/lib/profileOptions';
import { parseIbRecord, filledSubjects, hlCount } from '@/lib/ibDiploma';

/** @param {{ icon: React.ElementType, title: React.ReactNode, description?: string, children: React.ReactNode }} props */
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

/** @param {{ label: React.ReactNode, hint?: string, children: React.ReactNode, className?: string }} props */
function Field({ label, hint, children, className }) {
  return (
    <div className={className}>
      <div className="flex items-center gap-1.5 mb-1.5">
        <Label className="text-xs font-medium text-foreground/60">{label}</Label>
        {hint && (
          <span title={hint}>
            <Info className="w-3 h-3 text-foreground/25" />
          </span>
        )}
      </div>
      {children}
    </div>
  );
}

/**
 * Option lists here are a mix of plain strings and `{ value, label }` objects
 * depending on the field, so read both shapes through one pair of helpers.
 * @param {string | { value: string, label: string }} option
 */
const optionValue = (option) => (typeof option === 'string' ? option : option.value);
/** @param {string | { value: string, label: string }} option */
const optionLabel = (option) => (typeof option === 'string' ? option : option.label);

/** A dropdown with a free-text escape hatch, for "choose or type your own". */
/** @param {{ value?: string, onChange: (v: string) => void, options: readonly ({ value: string, label: string } | string)[], placeholder?: string, allowCustom?: boolean, customLabel?: string, id?: string }} props */
function ComboField({ value, onChange, options, placeholder, allowCustom = true, customLabel = 'Other — type your own', id }) {
  const isCustom = allowCustom && value && !options.some((o) => optionValue(o) === value);
  return (
    <div className="space-y-2">
      <Select
        value={isCustom ? '__custom__' : (value || '__none__')}
        onValueChange={(v) => {
          if (v === '__custom__') {
            onChange('__custom__');
            return;
          }
          onChange(v === '__none__' ? '' : v);
        }}
      >
        <SelectTrigger id={id} className="w-full">
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__none__">Not set</SelectItem>
          {options.map((o) => {
            const val = optionValue(o);
            return <SelectItem key={val} value={val}>{optionLabel(o)}</SelectItem>;
          })}
          {allowCustom && <SelectItem value="__custom__">{customLabel}</SelectItem>}
        </SelectContent>
      </Select>
      {isCustom && (
        <Input
          autoFocus
          value={value === '__custom__' ? '' : value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Type your own"
        />
      )}
    </div>
  );
}

const num = (v) => (v === '' || v === null || v === undefined ? null : Number(v));

/**
 * The editable profile. Every field is optional because a new applicant has
 * none of it yet, and because the database may predate a column — the backend
 * reports which optional columns are missing rather than failing the load.
 * @typedef {{
 *   full_name?: string,
 *   nationality?: string,
 *   citizenship_status?: string,
 *   graduation_year?: string | number,
 *   school_system?: string,
 *   curriculum?: string,
 *   first_generation?: string,
 *   background_summary?: string,
 *   education_notes?: string,
 *   ib_predicted_score?: number | string,
 *   ib_subjects?: string,
 *   gpa_value?: number | string,
 *   gpa_scale?: string,
 *   rank?: string,
 *   sat_math?: number | string,
 *   sat_ebrw?: number | string,
 *   act_score?: number | string,
 *   toefl_total?: number | string,
 *   duolingo_english?: number | string,
 *   test_policy?: string,
 *   additional_test_info?: string,
 *   activities?: unknown[],
 *   honors?: unknown[],
 *   requires_financial_aid?: boolean,
 *   funding_source?: string,
 *   financial_aid_notes?: string,
 *   additional_context?: string,
 * }} ProfileForm
 */

export default function Profile() {
  const [profile, setProfile] = useState(null);
  /** @type {[ProfileForm, Function]} */
  const [formData, setFormData] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [missingColumns, setMissingColumns] = useState([]);

  useEffect(() => {
    (async () => {
      try {
        const profiles = await base44.entities.Profile.list();
        if (profiles.length > 0) {
          setProfile(profiles[0]);
          setFormData(profiles[0]);
        } else {
          setFormData({ requires_financial_aid: true, school_system: 'IB World School' });
        }
      } catch (e) {
        console.error(e);
        toast.error('Could not load your profile', { description: e.message });
      } finally {
        setLoading(false);
      }
      // Which optional columns this database actually has.
      try {
        // Probe the database rather than waiting for a write to fail, so a
        // missing column is reported before any data is silently dropped.
        if (typeof base44.capabilities?.probe === 'function') {
          setMissingColumns(await base44.capabilities.probe());
        } else {
          setMissingColumns(base44.capabilities?.missingOptionalColumns?.() || []);
        }
      } catch { /* no capability API — assume complete */ }
    })();
  }, []);

  useEffect(() => {
    if (!dirty) return undefined;
    const handler = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  const set = (key, value) => {
    setFormData((prev) => ({ ...prev, [key]: value }));
    setDirty(true);
  };

  const ibRecord = useMemo(() => parseIbRecord(formData.ib_subjects), [formData.ib_subjects]);
  const ibFilled = useMemo(() => filledSubjects(ibRecord), [ibRecord]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload = {
        ...formData,
        school_system: formData.school_system || 'Other',
        // The picker already wrote the structured record. Re-parsing it into the
        // old "Physics HL, ..." string would drop TOK, the Extended Essay, and
        // the language the student typed.
        ib_subjects: formData.ib_subjects || '',
      };
      const updated = profile
        ? await base44.entities.Profile.update(profile.id, payload)
        : await base44.entities.Profile.create(payload);
      setProfile(updated);
      setFormData(updated);
      setDirty(false);
      toast.success('Profile saved', {
        description: 'Every essay, review and university research now uses this.',
      });
    } catch (e) {
      console.error(e);
      toast.error('Could not save your profile', { description: e.message });
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

  const gpaMax = (GPA_SCALES.find((s) => s.value === formData.gpa_scale) || {}).max;
  const hasIELTS = ['ielts_listening', 'ielts_reading', 'ielts_writing', 'ielts_speaking']
    .some((k) => formData[k] !== null && formData[k] !== undefined && formData[k] !== '');
  const hasSAT = formData.sat_math || formData.sat_ebrw;
  const hasTOEFL = !!formData.toefl_total || !!formData.duolingo_english;

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-semibold tracking-tight">My Profile</h1>
          <p className="text-foreground/50 mt-1.5">
            This is the raw material for every essay, review and research report. Anything you leave blank, the
            AI has to guess — or worse, nothing gets said at all.
          </p>
        </div>
        <Button onClick={handleSave} disabled={saving} className="shrink-0">
          {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </div>

      {missingColumns.length > 0 && (
        <div className="flex items-start gap-3 p-4 rounded-xl bg-slate-50 border border-slate-200">
          <Database className="w-4 h-4 text-slate-500 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-slate-800">
              Some fields on this page are not being saved yet
            </p>
            <p className="text-sm text-slate-600 mt-0.5">
              Your database is on the original schema. Everything still works, but these fields will disappear
              when you close the tab: <span className="font-mono text-xs">{missingColumns.join(', ')}</span>.
              Run <span className="font-mono text-xs">supabase/schema.sql</span> once in the Supabase SQL editor
              to turn them on — it is idempotent, so it is safe to re-run.
            </p>
          </div>
        </div>
      )}

      <SectionCard icon={User} title="Who you are" description="The context a US or UK reader needs to read the rest of this file">
        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="Preferred name" hint="Used in the application preview only">
            <Input value={formData.full_name || ''} onChange={(e) => set('full_name', e.target.value)} placeholder="e.g. Ren" />
          </Field>
          <Field label="Nationality" hint="Affects need-blind versus need-aware analysis at every school">
            <ComboField
              value={formData.nationality}
              onChange={(v) => set('nationality', v)}
              options={NATIONALITIES}
              placeholder="Choose your nationality"
            />
          </Field>
          <Field label="Citizenship status" hint="Permanent residency changes the aid analysis completely">
            <ComboField
              value={formData.citizenship_status}
              onChange={(v) => set('citizenship_status', v)}
              options={CITIZENSHIP_STATUSES}
              placeholder="Choose a status"
            />
          </Field>
          <Field label="Graduation year" hint="Sets which application cycle applies">
            <Input
              type="number"
              value={formData.graduation_year || ''}
              onChange={(e) => set('graduation_year', e.target.value)}
              placeholder="e.g. 2027"
            />
          </Field>
          <Field label="School system">
            <Select value={formData.school_system || 'IB World School'} onValueChange={(v) => { set('school_system', v); setDirty(true); }}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                {SCHOOL_SYSTEMS.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Curriculum">
            <ComboField
              value={formData.curriculum}
              onChange={(v) => set('curriculum', v)}
              options={CURRICULUM_TYPES}
              placeholder="Choose a curriculum"
            />
          </Field>
        </div>
        <div className="mt-4">
          <Field label="First-generation university applicant">
            <Select
              value={formData.first_generation || '__none__'}
              onValueChange={(v) => { set('first_generation', v === '__none__' ? '' : v); }}
            >
              <SelectTrigger className="w-full"><SelectValue placeholder="Select" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">Prefer not to say</SelectItem>
                {FIRST_GENERATION_OPTIONS.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
        </div>
        <div className="mt-4 space-y-4">
          <Field label="Background Summary" hint="Your story, identity, and context — the AI needs this to write anything personal">
            <Textarea
              value={formData.background_summary || ''}
              onChange={(e) => set('background_summary', e.target.value)}
              rows={4}
              placeholder="Who you are, what shaped you, what you are trying to do…"
            />
          </Field>
          <Field label="Education System Notes" hint="How an admissions reader should interpret your transcript">
            <Textarea
              value={formData.education_notes || ''}
              onChange={(e) => set('education_notes', e.target.value)}
              rows={3}
              placeholder="Explain your school system, how grading works, and what a US or UK committee needs to know to read it correctly…"
            />
          </Field>
        </div>
      </SectionCard>

      <SectionCard icon={GraduationCap} title="Academic Record" description="Grades, and the workload behind them">
        <div className="grid sm:grid-cols-3 gap-4">
          <Field label="IB predicted total" hint="Out of 45: up to 42 from six subjects, plus 0–3 from TOK and the Extended Essay. The picker can fill this from the predicted grades.">
            <Input
              type="number"
              min="0"
              max="45"
              value={formData.ib_predicted_score ?? ''}
              onChange={(e) => set('ib_predicted_score', num(e.target.value))}
              placeholder="e.g. 43"
            />
          </Field>
          <Field label="GPA">
            <Input
              type="number"
              step="0.01"
              max={gpaMax ?? undefined}
              value={formData.gpa_value || ''}
              onChange={(e) => set('gpa_value', e.target.value)}
              placeholder="e.g. 5.0"
            />
          </Field>
          <Field label="GPA scale" hint="Saying “3.9” without the scale is meaningless to a US reader">
            <Select value={formData.gpa_scale || '__none__'} onValueChange={(v) => set('gpa_scale', v === '__none__' ? '' : v)}>
              <SelectTrigger className="w-full"><SelectValue placeholder="Select scale" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">Not set</SelectItem>
                {GPA_SCALES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Class rank" hint="e.g. 12 / 145 — a top-percentile signal some schools weight heavily">
            <Input value={formData.rank || ''} onChange={(e) => set('rank', e.target.value)} placeholder="e.g. 12 / 145" />
          </Field>
        </div>

        <div className="mt-5">
          <div className="flex items-center justify-between mb-1.5">
            <Label className="text-xs font-medium text-foreground/60">IB Subjects</Label>
            <span className="text-[11px] text-foreground/35">
              {ibFilled.length}/6 subjects
              {` · ${hlCount(ibRecord)} HL`}
            </span>
          </div>
          <IbSubjectPicker
            raw={formData.ib_subjects || ''}
            onChange={(raw) => set('ib_subjects', raw)}
            onUsePredictedTotal={(total) => set('ib_predicted_score', total)}
          />
        </div>
      </SectionCard>

      <SectionCard icon={ClipboardList} title="Tests" description="Only fill in what you have actually sat">
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <Label className="text-xs font-medium text-foreground/60 mb-2 block">SAT (out of 800 each)</Label>
            <div className="grid grid-cols-2 gap-3">
              <Input
                type="number"
                value={formData.sat_math ?? ''}
                onChange={(e) => set('sat_math', num(e.target.value))}
                placeholder="Math"
              />
              <Input
                type="number"
                value={formData.sat_ebrw ?? ''}
                onChange={(e) => set('sat_ebrw', num(e.target.value))}
                placeholder="EBRW"
              />
            </div>
          </div>
          <div>
            <Label className="text-xs font-medium text-foreground/60 mb-2 block">ACT (composite)</Label>
            <Input
              type="number"
              max="36"
              value={formData.act_score ?? ''}
              onChange={(e) => set('act_score', num(e.target.value))}
              placeholder="1-36"
            />
          </div>
        </div>

        <div className="mt-5">
          <Label className="text-xs font-medium text-foreground/60 mb-2 block">English proficiency</Label>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              ['ielts_listening', 'IELTS L'], ['ielts_reading', 'IELTS R'],
              ['ielts_writing', 'IELTS W'], ['ielts_speaking', 'IELTS S'],
            ].map(([key, label]) => (
              <div key={key}>
                <span className="block text-[11px] text-foreground/45 mb-1">{label}</span>
                <Input
                  type="number"
                  step="0.5"
                  min="0"
                  max="9"
                  value={formData[key] ?? ''}
                  onChange={(e) => set(key, num(e.target.value))}
                  placeholder="0-9"
                />
              </div>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3 mt-3">
            <div>
              <span className="block text-[11px] text-foreground/45 mb-1">TOEFL iBT (out of 120)</span>
              <Input
                type="number"
                value={formData.toefl_total ?? ''}
                onChange={(e) => set('toefl_total', num(e.target.value))}
                placeholder="0-120"
              />
            </div>
            <div>
              <span className="block text-[11px] text-foreground/45 mb-1">Duolingo (out of 160)</span>
              <Input
                type="number"
                value={formData.duolingo_english ?? ''}
                onChange={(e) => set('duolingo_english', num(e.target.value))}
                placeholder="0-160"
              />
            </div>
          </div>
        </div>

        <div className="mt-5 grid sm:grid-cols-2 gap-4">
          <Field label="Testing policy" hint="What you believe applies at your target schools">
            <Select value={formData.test_policy || '__none__'} onValueChange={(v) => set('test_policy', v === '__none__' ? '' : v)}>
              <SelectTrigger className="w-full"><SelectValue placeholder="Select" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">Not set</SelectItem>
                {TEST_POLICIES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          <div />
        </div>

        <div className="mt-4">
          <Field label="Other test information" hint="ESAT, TMUA, CSAT, HAT, TSA, AP exams, retakes, dates">
            <Textarea
              value={formData.additional_test_info || ''}
              onChange={(e) => set('additional_test_info', e.target.value)}
              rows={3}
              placeholder="Admissions tests (ESAT, TMUA, CSAT…), AP exams, test dates, retake plans…"
            />
          </Field>
        </div>

        {!hasSAT && !hasIELTS && !hasTOEFL && !formData.act_score && (
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2.5 mt-4">
            No test scores saved. Test-optional schools will not be modelled correctly without them — even a
            “test optional” decision depends on knowing what you could have submitted.
          </p>
        )}
      </SectionCard>

      <SectionCard icon={Briefcase} title="Activities" description="Common App format — up to 10">
        <ActivitiesEditor value={formData.activities || []} onChange={(val) => set('activities', val)} />
      </SectionCard>

      <SectionCard icon={Award} title="Honors" description="Common App format — up to 5">
        <HonorsEditor value={formData.honors || []} onChange={(val) => set('honors', val)} />
      </SectionCard>

      <SectionCard icon={DollarSign} title="Financial Aid" description="This changes the strategy at every school you research">
        <div className="flex items-center justify-between p-3 rounded-lg bg-muted/40">
          <div>
            <Label className="text-sm font-medium cursor-pointer">I require financial aid</Label>
            <p className="text-xs text-foreground/40 mt-0.5">
              If off, Atlas analyses the admissions advantage of applying full-pay at need-aware schools
            </p>
          </div>
          <Switch
            checked={formData.requires_financial_aid ?? true}
            onCheckedChange={(v) => set('requires_financial_aid', v)}
          />
        </div>
        <div className="mt-4 grid sm:grid-cols-2 gap-4">
          <Field label="How is it funded?">
            <Select value={formData.funding_source || '__none__'} onValueChange={(v) => set('funding_source', v === '__none__' ? '' : v)}>
              <SelectTrigger className="w-full"><SelectValue placeholder="Select" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">Not set</SelectItem>
                {FUNDING_SOURCES.map((f) => <SelectItem key={f} value={f}>{f}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          <div />
        </div>
        {formData.requires_financial_aid && (
          <div className="mt-4">
            <Field label="Financial Aid Notes" hint="CSS Profile, scholarships you have applied to, constraints">
              <Textarea
                value={formData.financial_aid_notes || ''}
                onChange={(e) => set('financial_aid_notes', e.target.value)}
                rows={2}
                placeholder="Aid forms you must complete, scholarships in play, any constraints…"
              />
            </Field>
          </div>
        )}
      </SectionCard>

      <SectionCard icon={FileText} title="Additional Context" description="Anything else that shapes your application">
        <Textarea
          value={formData.additional_context || ''}
          onChange={(e) => set('additional_context', e.target.value)}
          rows={4}
          placeholder="Caregiving responsibilities, a gap year, a health situation, a target you are working towards, anything you would otherwise have to explain twice…"
        />
      </SectionCard>

      <SectionCard icon={Landmark} title="University research so far" description="What the Knowledge Base has already established">
        <div className="flex flex-wrap gap-2">
          {formData.background_summary && <Badge variant="outline">Background written</Badge>}
          {!!formData.ib_predicted_score && <Badge variant="outline">IB {formData.ib_predicted_score}/45</Badge>}
          {ibFilled.length > 0 && <Badge variant="outline">{ibFilled.length} IB subjects</Badge>}
          {hasSAT && <Badge variant="outline">SAT on file</Badge>}
          {hasIELTS && <Badge variant="outline">IELTS on file</Badge>}
          {(formData.activities || []).length > 0 && <Badge variant="outline">{(formData.activities || []).length} activities</Badge>}
          {(formData.honors || []).length > 0 && <Badge variant="outline">{(formData.honors || []).length} honors</Badge>}
          {formData.requires_financial_aid === false && <Badge variant="outline">Full-pay</Badge>}
        </div>
        <p className="text-xs text-foreground/40 mt-3 leading-relaxed">
          The AI is instructed to be strict, so a thin profile produces a harsh review. The gaps above are the
          cheapest admissions improvements available to you.
        </p>
      </SectionCard>

      <div className="flex justify-between items-center gap-4">
        <span className="text-xs text-foreground/35">
          {dirty ? 'Unsaved changes' : 'Everything is saved'}
        </span>
        <Button onClick={handleSave} disabled={saving || !dirty}>
          {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
          {saving ? 'Saving…' : 'Save profile'}
        </Button>
      </div>
    </div>
  );
}