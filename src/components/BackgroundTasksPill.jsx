import { useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, ListChecks } from 'lucide-react';
import { useBackgroundTasks } from '@/hooks/use-background-tasks';
import { describeStage } from '@/lib/backgroundTasks';

const elapsed = (startedAt) => {
  const seconds = Math.max(0, Math.round((Date.now() - (startedAt || Date.now())) / 1000));
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
};

/**
 * What Atlas is doing in the background right now.
 *
 * AI work keeps running when the applicant leaves the page that started it, so
 * this is the one place that always says what is in flight: a draft being
 * written for one essay, the knowledge base re-examining itself, a full
 * application review. It renders nothing when nothing is running and nothing
 * has just finished, so an idle sidebar stays quiet.
 *
 * @param {object} props
 * @param {object[]} [props.tasks] tasks to show (tests pass fixtures; the app reads the registry)
 */
export default function BackgroundTasksPill({ tasks: given = null }) {
  const live = useBackgroundTasks();
  const tasks = Array.isArray(given) ? given : live;
  const [open, setOpen] = useState(false);
  const running = tasks.filter((task) => task.state === 'running');
  const settled = tasks.filter((task) => task.state === 'done' || task.state === 'failed');
  if (!running.length && !settled.length) return null;
  const failed = settled.filter((task) => task.state === 'failed');

  const tone = running.length
    ? 'text-accent border-accent/30 bg-accent/5'
    : failed.length
      ? 'text-amber-700 border-amber-300 bg-amber-50'
      : 'text-green-700 border-green-300 bg-green-50';
  const Icon = running.length ? Loader2 : failed.length ? AlertTriangle : CheckCircle2;
  const label = running.length
    ? `${running.length} AI job${running.length === 1 ? '' : 's'} running`
    : failed.length
      ? `${failed.length} AI job${failed.length === 1 ? '' : 's'} failed`
      : 'AI work finished';

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className={`w-full inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition ${tone}`}
        title="Background AI work. You can keep editing anything else while it runs."
      >
        <Icon className={`w-3.5 h-3.5 shrink-0 ${running.length ? 'animate-spin' : ''}`} />
        <span className="truncate">{label}</span>
        <ListChecks className="w-3 h-3 ml-auto shrink-0 opacity-60" />
      </button>
      {open && (
        <div className="mt-2 rounded-lg border border-border bg-card p-2.5 space-y-2 text-[11px] leading-snug">
          {[...running, ...settled].slice(0, 6).map((task) => (
            <div key={task.id} className="flex items-start gap-2">
              {task.state === 'running'
                ? <Loader2 className="w-3 h-3 mt-px shrink-0 animate-spin text-accent" />
                : task.state === 'failed'
                  ? <AlertTriangle className="w-3 h-3 mt-px shrink-0 text-amber-600" />
                  : <CheckCircle2 className="w-3 h-3 mt-px shrink-0 text-green-600" />}
              <div className="min-w-0">
                <p className="font-medium text-foreground/80 truncate">{task.label}</p>
                <p className="text-foreground/45">
                  {task.state === 'running'
                    ? `${describeStage(task.stage)}${task.detail ? ` — ${task.detail}` : ''} · ${elapsed(task.startedAt)}`
                    : task.state === 'failed'
                      ? (task.error?.message || 'Failed')
                      : 'Done — the result is saved where it belongs.'}
                </p>
              </div>
            </div>
          ))}
          <p className="text-foreground/35 pt-1 border-t border-border">
            Everything else stays editable while this runs. Results are saved even if you move to another page.
          </p>
        </div>
      )}
    </div>
  );
}
