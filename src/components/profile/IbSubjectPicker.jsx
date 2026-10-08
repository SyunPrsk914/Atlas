import { useMemo, useState } from 'react';
import { GraduationCap, Info } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  IB_SLOTS, SUBJECT_GRADES, CORE_GRADES, HL_MAX,
  parseIbRecord, serializeIbRecord, coursesForGroups, courseById, emptySubject,
  languagesFor, subjectDisplayName, hlCount, filledSubjects,
  corePoints, suggestedDiplomaTotal, ibWarnings, eeSubjectName, emptyEeCourse,
} from '@/lib/ibDiploma';

const NONE = '__none__';
// The Extended Essay may be written in any of the six groups' subjects.
const EE_COURSES = coursesForGroups([1, 2, 3, 4, 5, 6]);

/**
 * Extended Essay subject: the same catalogue and the same "not listed — type
 * it" path as the six diploma subjects, so spelling and naming match everywhere.
 */
function ExtendedEssaySubject({ eeCourse, onChange }) {
  const [customLanguage, setCustomLanguage] = useState(false);
  const course = courseById(eeCourse.courseId);
  const languages = course ? languagesFor(course.needsLanguage) : [];
  const languageIsCustom = customLanguage
    || (!!eeCourse.language && !languages.includes(eeCourse.language));
  const displayName = eeSubjectName({ eeCourse });

  return (
    <div className="space-y-2">
      <Select
        value={eeCourse.courseId || NONE}
        onValueChange={(value) => {
          setCustomLanguage(false);
          onChange({ courseId: value === NONE ? '' : value, language: '', customName: '' });
        }}
      >
        <SelectTrigger className="w-full">
          <SelectValue placeholder="Choose the subject" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>Not chosen</SelectItem>
          {EE_COURSES.map((item) => (
            <SelectItem key={item.id} value={item.id}>{item.label}</SelectItem>
          ))}
          <SelectItem value="custom">Not listed — type it</SelectItem>
        </SelectContent>
      </Select>

      {eeCourse.courseId === 'custom' ? (
        <Input
          value={eeCourse.customName || ''}
          onChange={(e) => onChange({ ...eeCourse, customName: e.target.value })}
          placeholder="Subject name as your school reports it"
        />
      ) : course?.needsLanguage ? (
        <div className="space-y-2">
          <Select
            value={languageIsCustom ? '__other__' : (eeCourse.language || NONE)}
            onValueChange={(value) => {
              if (value === '__other__') {
                setCustomLanguage(true);
                if (languages.includes(eeCourse.language)) onChange({ ...eeCourse, language: '' });
                return;
              }
              setCustomLanguage(false);
              onChange({ ...eeCourse, language: value === NONE ? '' : value });
            }}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Choose the language" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>Choose the language</SelectItem>
              {languages.map((language) => (
                <SelectItem key={language} value={language}>{language}</SelectItem>
              ))}
              <SelectItem value="__other__">Other — type the language</SelectItem>
            </SelectContent>
          </Select>
          {languageIsCustom && (
            <Input
              autoFocus
              value={eeCourse.language || ''}
              onChange={(e) => onChange({ ...eeCourse, language: e.target.value })}
              placeholder="Type the language — the lists are suggestions, not a closed catalogue"
            />
          )}
        </div>
      ) : null}

      {displayName && (
        <p className="text-[11px] text-foreground/40">Reported as “{displayName}”</p>
      )}
    </div>
  );
}

/**
 * The diploma is six subjects plus TOK and the Extended Essay — eight slots,
 * not a free list of ten. Predicted grades are stored for review. They are
 * not final results and this app does not send them to a university.
 */
export default function IbSubjectPicker({ raw = '', onChange, onUsePredictedTotal }) {
  const record = useMemo(() => parseIbRecord(raw), [raw]);
  const [customLanguage, setCustomLanguage] = useState({});

  const commit = (next) => onChange(serializeIbRecord(next));

  const setSubject = (slotId, patch) => {
    commit({
      ...record,
      subjects: record.subjects.map((subject) => (
        subject.slot === slotId ? { ...subject, ...patch } : subject
      )),
    });
  };

  const setCourse = (slotId, courseId) => {
    const course = courseById(courseId);
    setSubject(slotId, {
      courseId: courseId === NONE ? '' : courseId,
      language: '',
      customName: '',
      level: course?.levels.length === 1 ? course.levels[0] : '',
      grade: '',
    });
  };

  const warnings = ibWarnings(record);
  const taken = filledSubjects(record);
  const hl = hlCount(record);
  const core = corePoints(record.tok, record.ee);
  const suggested = suggestedDiplomaTotal(record);

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-1.5">
        <p className="text-xs text-foreground/70 leading-relaxed">
          Six subjects, plus Theory of Knowledge and the Extended Essay. Predicted grades are what your
          school currently expects you to be awarded. Atlas uses them when it reviews your file. They are
          not final results, and this app does not submit them to a university.
        </p>
        <p className="text-xs text-foreground/45 leading-relaxed">
          A diploma is 3 or 4 Higher Level subjects — 4 HL is allowed — and the rest Standard Level.
          Subjects are graded 1–7. TOK and the Extended Essay are graded A–E and add 0–3 points.
          Language A: Literature can be any language with a written literature; if yours is not in the
          list, type it.
        </p>
      </div>

      <label className="flex items-center gap-2 text-xs text-foreground/60">
        <input
          type="checkbox"
          checked={record.diploma !== false}
          onChange={(e) => commit({ ...record, diploma: e.target.checked })}
          className="rounded border-border"
        />
        I am taking the full IB Diploma (six subjects + core). Uncheck this if you are taking course certificates only.
      </label>

      <div className="space-y-3">
        {IB_SLOTS.map((slot) => {
          const subject = record.subjects.find((s) => s.slot === slot.id) || emptySubject(slot.id);
          const courses = coursesForGroups(slot.groups);
          const course = courseById(subject.courseId);
          const languages = course ? languagesFor(course.needsLanguage) : [];
          const languageIsCustom = !!customLanguage[slot.id]
            || (!!subject.language && !languages.includes(subject.language));
          return (
            <div key={slot.id} className="rounded-lg border border-border p-3 space-y-2.5">
              <div>
                <p className="text-sm font-medium">{slot.label}</p>
                <p className="text-[11px] text-foreground/45 leading-relaxed">{slot.hint}</p>
              </div>
              <div className="grid sm:grid-cols-2 gap-2">
                <Select
                  value={subject.courseId || NONE}
                  onValueChange={(value) => setCourse(slot.id, value)}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Choose a subject" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Not chosen</SelectItem>
                    {courses.map((item) => (
                      <SelectItem key={item.id} value={item.id}>{item.label}</SelectItem>
                    ))}
                    <SelectItem value="custom">Not listed — type it</SelectItem>
                  </SelectContent>
                </Select>

                {subject.courseId === 'custom' ? (
                  <Input
                    value={subject.customName || ''}
                    onChange={(e) => setSubject(slot.id, { customName: e.target.value })}
                    placeholder="Subject name as your school reports it"
                  />
                ) : course?.needsLanguage ? (
                  <div className="space-y-2">
                    <Select
                      value={languageIsCustom ? '__other__' : (subject.language || NONE)}
                      onValueChange={(value) => {
                        if (value === '__other__') {
                          setCustomLanguage((prev) => ({ ...prev, [slot.id]: true }));
                          if (languages.includes(subject.language)) setSubject(slot.id, { language: '' });
                          return;
                        }
                        setCustomLanguage((prev) => ({ ...prev, [slot.id]: false }));
                        setSubject(slot.id, { language: value === NONE ? '' : value });
                      }}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Choose the language" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NONE}>Choose the language</SelectItem>
                        {languages.map((language) => (
                          <SelectItem key={language} value={language}>{language}</SelectItem>
                        ))}
                        <SelectItem value="__other__">Other — type the language</SelectItem>
                      </SelectContent>
                    </Select>
                    {languageIsCustom && (
                      <Input
                        autoFocus
                        value={subject.language || ''}
                        onChange={(e) => setSubject(slot.id, { language: e.target.value })}
                        placeholder="Type the language — the lists are suggestions, not a closed catalogue"
                      />
                    )}
                  </div>
                ) : (
                  <div />
                )}
              </div>

              {subject.courseId && (
                <div className="flex flex-wrap gap-2">
                  <Select
                    value={subject.level || NONE}
                    onValueChange={(value) => setSubject(slot.id, { level: value === NONE ? '' : value })}
                  >
                    <SelectTrigger className="w-36">
                      <SelectValue placeholder="HL or SL" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>Level</SelectItem>
                      {(course?.levels || ['HL', 'SL']).map((level) => (
                        <SelectItem key={level} value={level}>
                          {level === 'HL' ? 'HL — Higher Level' : 'SL — Standard Level'}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select
                    value={subject.grade || NONE}
                    onValueChange={(value) => setSubject(slot.id, { grade: value === NONE ? '' : value })}
                  >
                    <SelectTrigger className="w-44">
                      <SelectValue placeholder="Predicted grade" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>No predicted grade</SelectItem>
                      {SUBJECT_GRADES.map((grade) => (
                        <SelectItem key={grade} value={grade}>Predicted {grade}/7</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {subjectDisplayName(subject) && (
                    <span className="text-[11px] text-foreground/40 self-center">
                      Reported as “{subjectDisplayName(subject)}{subject.level ? ` ${subject.level}` : ''}”
                    </span>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="grid sm:grid-cols-2 gap-3">
        <div className="rounded-lg border border-border p-3 space-y-2">
          <p className="text-sm font-medium">Theory of Knowledge</p>
          <p className="text-[11px] text-foreground/45">
            Predicted grade A–E. This is not a seventh subject and is not graded 1–7.
          </p>
          <Select value={record.tok || NONE} onValueChange={(value) => commit({ ...record, tok: value === NONE ? '' : value })}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="TOK predicted grade" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>No predicted grade</SelectItem>
              {CORE_GRADES.map((grade) => (
                <SelectItem key={grade} value={grade}>Predicted {grade}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="rounded-lg border border-border p-3 space-y-2">
          <p className="text-sm font-medium">Extended Essay</p>
          <p className="text-[11px] text-foreground/45">
            Predicted grade A–E, and the subject the essay is in. CAS is required but not graded, so it is not a slot.
          </p>
          <ExtendedEssaySubject
            eeCourse={record.eeCourse || emptyEeCourse()}
            onChange={(eeCourse) => commit({ ...record, eeCourse })}
          />
          <Select value={record.ee || NONE} onValueChange={(value) => commit({ ...record, ee: value === NONE ? '' : value })}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="EE predicted grade" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>No predicted grade</SelectItem>
              {CORE_GRADES.map((grade) => (
                <SelectItem key={grade} value={grade}>Predicted {grade}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {record.unplaced?.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
          <p className="text-xs text-amber-800">
            These older entries did not match an official subject and were kept so nothing was deleted:
            {' '}{record.unplaced.join('; ')}. Re-enter them in the slots above, then dismiss.
          </p>
          <button
            type="button"
            className="text-[11px] text-amber-800 underline mt-1"
            onClick={() => commit({ ...record, unplaced: [] })}
          >
            Dismiss imported entries
          </button>
        </div>
      )}

      {warnings.map((warning) => (
        <p key={warning} className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2.5 flex gap-2">
          <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          {warning}
        </p>
      ))}

      <div className="flex items-center gap-2 flex-wrap">
        <Badge variant="outline" className="gap-1">
          <GraduationCap className="w-3 h-3" />
          {taken.length}/6 subjects
        </Badge>
        <Badge variant="outline" className={hl > HL_MAX ? 'text-destructive border-destructive/40' : ''}>
          {hl} HL (3 or 4 allowed)
        </Badge>
        <Badge variant="outline">
          TOK {record.tok || '—'} · EE {record.ee || '—'}
          {core.complete && !core.failing ? ` · +${core.points}` : ''}
          {core.failing ? ' · failing condition' : ''}
        </Badge>
        {suggested != null && (
          <button
            type="button"
            className="text-[11px] text-accent hover:underline"
            onClick={() => onUsePredictedTotal?.(suggested)}
          >
            Use suggested total {suggested}/45
          </button>
        )}
      </div>
    </div>
  );
}
