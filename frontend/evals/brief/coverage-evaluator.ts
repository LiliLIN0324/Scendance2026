import { parseBriefConversation } from '../../../supabase/functions/_shared/brief-extract-contract';

/** Human-authored labels for fictional evaluation cases, not a production classifier. */
export type CoverageLabel =
  | { id: string; source: string; kind: 'fact'; field: 'headcount' | 'venueIO' | 'layoutMode'; value: number | string; mode?: 'must' | 'prefer'; requiredForDelivery: boolean }
  | { id: string; source: string; kind: 'need'; need: 'checkin' | 'stage' | 'rest' | 'all_seated'; value: 'needed' | 'not_needed' | 'unknown'; requiredForDelivery: boolean }
  | { id: string; source: string; kind: 'inventory'; requiredForDelivery: boolean }
  | { id: string; source: string; kind: 'unmodeled'; requiredForDelivery: boolean };

export type CoverageCase = { id: string; message: string; task: 'planning' | 'question'; labels: CoverageLabel[]; criticalSafety?: string[]; allowNotApplicable?: string[] };
export type FourValue = 'pass' | 'violated' | 'unknown' | 'not_applicable';
export type ObservedDelivery = {
  /** Collected separately from the model reply by the evaluator/operator. */
  candidate: 'none' | 'preview' | 'applied';
  userConfirmed: boolean;
  requirements: Record<string, FourValue>;
  safety: Record<string, FourValue>;
};
export type CoverageState = 'recognized' | 'reported_unhandled' | 'missing' | 'contradicted';

const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const rows = (value: unknown): Record<string, unknown>[] => Array.isArray(value) ? value.map(record) : [];
const hasGroundedText = (value: unknown, source: string, message: string): boolean =>
  typeof value === 'string' && value.includes(source) && message.includes(value);

/** Review original model fields separately from any production parser repair or heuristic. */
function coverageFor(test: CoverageCase, output: unknown) {
  const model = record(output), extraction = record(model.extraction);
  const factEvidence = rows(model.factEvidence), unhandledRows = rows(model.unhandled);
  const needs = rows(extraction.activityNeeds), inventories = rows(extraction.inventoryMentions), strengths = rows(extraction.requirements);
  return test.labels.map(label => {
    const unhandled = unhandledRows.some(item => item.kind !== 'question' && hasGroundedText(item.evidence, label.source, test.message));
    let state: CoverageState = 'missing';
    if (label.kind === 'fact') {
      const value = extraction[label.field];
      const evidence = factEvidence.find(item => item.key === label.field);
      const strength = strengths.find(item => item.key === label.field);
      if (value != null && value !== label.value) state = 'contradicted';
      else if (label.mode && strength && (strength.mode !== label.mode || strength.value !== label.value)) state = 'contradicted';
      else if (value === label.value && hasGroundedText(evidence?.evidence, label.source, test.message) && (!label.mode || (strength?.mode === label.mode && strength.value === label.value))) state = 'recognized';
      else if (unhandled) state = 'reported_unhandled';
    } else if (label.kind === 'need') {
      const need = needs.find(item => item.kind === label.need);
      if (need && need.decision !== label.value) state = 'contradicted';
      else if (need?.decision === label.value && hasGroundedText(need.evidence, label.source, test.message)) state = 'recognized';
      else if (unhandled) state = 'reported_unhandled';
    } else if (label.kind === 'inventory') {
      if (inventories.some(item => hasGroundedText(item.evidence, label.source, test.message))) state = 'recognized';
      else if (unhandled) state = 'reported_unhandled';
    } else if (unhandled) state = 'reported_unhandled';
    return { id: label.id, state, requiredForDelivery: label.requiredForDelivery };
  });
}

/** Fixed names only: an uncovered model field requires human review, not automatic approval. */
function unlabeledOutputs(test: CoverageCase, output: unknown): string[] {
  const extraction = record(record(output).extraction), result = new Set<string>();
  const factFields = ['event','headcount','venueIO','lengthM','widthM','areaM2','layoutMode','timeOfDay','mobilityAssistance','audienceTags'] as const;
  for (const field of factFields) {
    const value = extraction[field];
    if (value != null && (!Array.isArray(value) || value.length > 0) && !test.labels.some(label => label.kind === 'fact' && label.field === field)) result.add(field);
  }
  for (const item of rows(extraction.activityNeeds)) {
    const kind = item.kind;
    if (typeof kind === 'string' && ['checkin','stage','rest','all_seated'].includes(kind) && !test.labels.some(label => label.kind === 'need' && label.need === kind)) result.add(`need.${kind}`);
  }
  if (rows(extraction.inventoryMentions).length && !test.labels.some(label => label.kind === 'inventory')) result.add('inventoryMentions');
  return [...result];
}

/**
 * Measures a fixed, independently labelled case. A cited substring establishes
 * provenance only: it does not prove the model interpreted it correctly or
 * that the corresponding object exists in the real venue.
 */
export function evaluateRequirementCoverage(test: CoverageCase, modelResponse: unknown, observed?: ObservedDelivery) {
  if (test.task === 'question' && test.labels.length > 0) throw new Error('mixed questions and requirements must be labelled as planning');
  const ids = new Set<string>();
  for (const label of test.labels) {
    if (!label.id || ids.has(label.id) || !label.source || !test.message.includes(label.source)) throw new Error('invalid evaluation labels');
    ids.add(label.id);
  }
  // Never let production normalization/heuristics silently rewrite the model's score.
  const coverage = coverageFor(test, modelResponse);
  const unlabeled = unlabeledOutputs(test, modelResponse);
  let parsed: ReturnType<typeof parseBriefConversation>;
  try { parsed = parseBriefConversation(modelResponse, test.message); }
  catch {
    return { id: test.id, extraction: 'invalid' as const, coverage, systemCoverage: [], unlabeled, delivery: test.task === 'question' ? 'not_applicable' as const : 'not_verified' as const };
  }
  const systemCoverage = coverageFor(test, parsed);
  if (test.task === 'question') return { id: test.id, extraction: 'checked' as const, coverage, systemCoverage, unlabeled, delivery: 'not_applicable' as const };
  const hasMissing = coverage.some(item => item.state === 'missing' || item.state === 'contradicted');
  const hasDeferred = coverage.some(item => item.requiredForDelivery && item.state !== 'recognized');
  const hasUndecided = test.labels.some(label => label.kind === 'need' && label.value === 'unknown');
  const requiredIds = test.labels.filter(item => item.requiredForDelivery).map(item => item.id);
  // An empty set of safety checks, a preview, absent evidence, unknown results,
  // or an unverifiable requirement cannot be promoted to delivery-ready.
  const safetyIds = test.criticalSafety ?? [];
  const evidenceComplete = observed?.candidate === 'applied' && observed.userConfirmed === true &&
    observed.requirements != null && observed.safety != null && safetyIds.length > 0 &&
    requiredIds.every(id => observed.requirements[id] === 'pass') &&
    Object.values(observed.requirements).every(value => value !== 'violated') &&
    safetyIds.every(id => observed.safety[id] === 'pass' ||
      (observed.safety[id] === 'not_applicable' && test.allowNotApplicable?.includes(id))) &&
    Object.entries(observed.safety).every(([id, value]) => value === 'pass' ||
      (value === 'not_applicable' && test.allowNotApplicable?.includes(id)));
  const delivery = hasMissing || hasDeferred || hasUndecided || unlabeled.length ? 'not_ready' as const : evidenceComplete ? 'observed_ready_for_human_review' as const : 'not_verified' as const;
  return { id: test.id, extraction: 'checked' as const, coverage, systemCoverage, unlabeled, delivery };
}
