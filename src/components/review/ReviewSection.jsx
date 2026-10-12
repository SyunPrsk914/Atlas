import { useState } from 'react';
import { ChevronDown } from 'lucide-react';

/** Small accessible disclosure for independently collapsing one review result. */
export default function ReviewSection({ title, detail = '', leading = null, children, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section className="bg-card border border-border rounded-xl overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="w-full flex items-center gap-2.5 px-4 py-3.5 text-left hover:bg-muted/30 transition"
        aria-expanded={open}
      >
        {leading}
        <span className="flex-1 min-w-0 text-sm font-medium">{title}</span>
        {detail && <span className="text-[11px] text-foreground/40 shrink-0">{detail}</span>}
        <ChevronDown className={`w-4 h-4 text-foreground/40 shrink-0 transition-transform ${open ? '' : '-rotate-90'}`} />
      </button>
      {open && <div className="border-t border-border p-4">{children}</div>}
    </section>
  );
}
