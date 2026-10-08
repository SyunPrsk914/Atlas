import { Calendar, Clock, CheckCircle2, AlertTriangle, Info } from 'lucide-react';
import { PLATFORMS } from '@/lib/essayScope';

const US_TIMELINE = [
  { date: 'Aug 1', label: 'Common App & Coalition open', detail: 'Create accounts, start profile. UC application also opens.' },
  { date: 'Aug - Oct', label: 'Research & draft', detail: 'Research each university in Knowledge Base, draft shared essays (Common App personal statement 650w, UC PIQs 350w x4). Request recommendations.' },
  { date: 'Oct 15', label: 'Early deadlines (some)', detail: 'Some EA/ED deadlines. UCAS Oxbridge/medicine also closes today.' },
  { date: 'Nov 1', label: 'EA / ED / REA deadline', detail: 'Most Early Action / Early Decision / Restrictive Early Action close. Harvard, Stanford, MIT, etc.' },
  { date: 'Nov 30', label: 'UC deadline', detail: 'UC application closes 11:59pm PST. 4 PIQs, no recommendations, no interview for most.' },
  { date: 'Jan 1-5', label: 'Regular Decision', detail: 'Common App RD closes. Supplements must be done. FAFSA/CSS Profile for aid.' },
  { date: 'Mar-Apr', label: 'Decisions & aid', detail: 'Compare offers, aid packages, visit. Need-aware vs need-blind matters for internationals.' },
  { date: 'May 1', label: 'National College Decision Day', detail: 'Deposit deadline for US.' },
];

const UK_TIMELINE = [
  { date: 'May', label: 'UCAS opens', detail: 'Start course search — 5 choices max, same personal statement for all.' },
  { date: 'Jun-Sep', label: 'Draft personal statement', detail: '3 fixed questions sharing 4000 characters (min 350 each). 80% academic for Oxford, 20% non-academic cap for Cambridge.' },
  { date: 'Sep', label: 'Admissions tests registration', detail: 'ESAT, TMUA, MAT, PAT, etc. — register early, many in Oct.' },
  { date: 'Oct 15', label: 'Oxbridge / Medicine deadline', detail: 'UCAS closes 18:00 UK time for Oxford, Cambridge, medicine, dentistry, vet. Cambridge: My Cambridge Application by Oct 22 with extra 1200-char statement.' },
  { date: 'Oct-Nov', label: 'Tests & interviews', detail: 'Written tests, then Oxford/Cambridge interviews in Dec.' },
  { date: 'Jan 13', label: 'UCAS regular deadline', detail: 'All other UK courses close 18:00 UK time. One statement for all 5 choices.' },
  { date: 'Feb-May', label: 'Offers', detail: 'Conditional / unconditional. IB predicted grades matter — offers often 40-43/45 for top courses.' },
  { date: 'Jul-Aug', label: 'Results & confirmation', detail: 'IB results early Jul, confirmation, clearing if needed.' },
];

export default function ApplicationTimeline({ country, platform }) {
  const isUK = country === 'UK' || platform === 'ucas';
  const timeline = isUK ? UK_TIMELINE : US_TIMELINE;
  const title = isUK ? 'UK UCAS Timeline — 2026-27 cycle' : 'US Application Timeline — 2026-27 cycle';
  const note = isUK
    ? 'One personal statement for all 5 choices. Never name a university. Academic motivation first.'
    : 'Shared essays (Common App personal statement, UC PIQs) written once. Supplements are school-specific and must not repeat shared material.';

  return (
    <div className="bg-card border border-border rounded-xl p-5">
      <div className="flex items-center gap-2 mb-1">
        <Calendar className="w-4 h-4 text-foreground/40" />
        <h3 className="font-medium text-sm">{title}</h3>
      </div>
      <p className="text-xs text-foreground/45 mb-4 flex items-start gap-1.5">
        <Info className="w-3 h-3 mt-0.5 shrink-0" />
        {note}
      </p>
      <div className="space-y-3">
        {timeline.map((item, i) => (
          <div key={i} className="flex gap-3">
            <div className="flex flex-col items-center">
              <div className="w-6 h-6 rounded-full bg-foreground/5 border border-border flex items-center justify-center">
                <span className="text-[10px] font-medium">{i + 1}</span>
              </div>
              {i < timeline.length - 1 && <div className="w-px h-8 bg-border mt-1" />}
            </div>
            <div className="flex-1 pb-6">
              <div className="flex items-baseline gap-2 flex-wrap">
                <span className="text-xs font-medium px-2 py-0.5 rounded bg-muted text-foreground/70">{item.date}</span>
                <span className="text-sm font-medium">{item.label}</span>
              </div>
              <p className="text-xs text-foreground/50 mt-1 leading-relaxed">{item.detail}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
