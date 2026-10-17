import { useEffect, useState } from 'react';
import { listTasks, subscribeBackgroundTasks } from '@/lib/backgroundTasks';

/**
 * The background task ledger as React state.
 *
 * Re-renders whenever a task starts, changes stage, finishes, or is forgotten.
 * `onChange`, when given, is called with the task that changed, which is how a
 * page notices that a job it did not start (an earlier visit to the same page)
 * has just finished and reloads the row it wrote.
 *
 * @param {(task: object, all: object[]) => void} [onChange]
 * @returns {object[]} every listed task (running and recently settled)
 */
export function useBackgroundTasks(onChange) {
  const [tasks, setTasks] = useState(() => listTasks());
  useEffect(() => {
    setTasks(listTasks());
    return subscribeBackgroundTasks((task, all) => {
      setTasks(all);
      if (onChange) onChange(task, all);
    });
    // The subscription is cheap to re-create when the handler changes.
  }, [onChange]);
  return tasks;
}
