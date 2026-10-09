// The one material job queue the app uses, wired to the real reader, the real
// model call, and the real database. Pages import this; tests build their own
// queue with createMaterialJobs.

import { base44 } from '@/api/base44Client';
import { runAI, notifyAIError } from '@/lib/ai';
import { hasLiveModel } from '@/lib/aiOutcome';
import { readFromFile, readFromUrl, readStoredFile } from '@/lib/documentReader';
import { analyzeDocument } from '@/lib/materialAnalysis';
import { createMaterialJobs } from '@/lib/materialJobs';

export const materialJobs = createMaterialJobs({
  readFile: readFromFile,
  readUrl: readFromUrl,
  readStored: readStoredFile,
  analyze: (args) => analyzeDocument({ ...args, runAI }),
  // Demo mode is placeholder output; nothing is analysed without a real model.
  hasModel: hasLiveModel,
  save: (id, patch) => base44.entities.Material.update(id, patch),
  load: (id) => base44.entities.Material.get(id),
  reportError: (error, title) => notifyAIError(error, `Could not process “${title}”`),
});
