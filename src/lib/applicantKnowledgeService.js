// Loads the applicant's knowledge base as prompt text, for drafting, review,
// and the holistic review. Scope filters are applied before text is assembled.
// If the table is not in the database yet, the prompts simply go without it;
// the AI Knowledge Base page explains how to add it.
import { base44 } from '@/api/base44Client';
import { applicantKnowledgeForPrompt } from '@/lib/applicantKnowledge';

export async function loadApplicantKnowledgeText(options = {}) {
  try {
    const rows = await base44.entities.ApplicantKnowledge.list();
    return applicantKnowledgeForPrompt(rows, options);
  } catch (error) {
    console.warn('[atlas] applicant knowledge is unavailable:', error?.message || error);
    return '';
  }
}
