/**
 * Grading and aggregate metrics for eval rows. Pure functions, unit-tested in
 * test/metrics.test.js.
 */

/** Grade one row against its expectation. */
export function grade(row) {
  const { expect } = row;
  const top1 = row.rank[0] ?? null;
  // A forbidden article must not be ranked first, offered, put in the prompt or cited.
  const neverViolated = (expect.never ?? []).some(
    (id) => top1 === id || row.citations.includes(id) || row.options.includes(id) || (row.contextIds ?? []).includes(id),
  );
  // When the question reaches the model, the prompt must say which "client" was meant.
  const promptMissed = Boolean(expect.promptSays && row.outcome === 'answer' && !(row.interpretation ?? []).some((n) => n.includes(expect.promptSays)));
  let pass;
  if (expect.type === 'answer') {
    pass = row.outcome === 'answer' && row.citations.includes(expect.article) && !promptMissed;
  } else if (expect.type === 'clarify') {
    pass =
      row.outcome === 'clarify' &&
      expect.mustInclude.every((id) => row.options.includes(id)) &&
      (!expect.allowed || row.options.every((id) => expect.allowed.includes(id)));
  } else if (expect.type === 'assistant') {
    pass = row.outcome === 'assistant';
  } else {
    pass = row.outcome === 'escalate';
  }
  return { pass: pass && !neverViolated, neverViolated, promptMissed };
}

const ratio = (num, den) => (den ? num / den : null);

/**
 * @param {Array<object>} rows graded rows
 * @param {Set<string>} kbIds ids of every article in the help centre
 */
export function summarise(rows, kbIds) {
  const answerable = rows.filter((r) => r.expect.type === 'answer');
  const clarifyCases = rows.filter((r) => r.expect.type === 'clarify');
  const escalateCases = rows.filter((r) => r.expect.type === 'escalate');
  const answered = rows.filter((r) => r.outcome === 'answer');
  const escalated = rows.filter((r) => r.outcome === 'escalate');

  // Retrieval: is the expected article ranked first / in the top three?
  const hitAt = (k) => ratio(answerable.filter((r) => r.rank.slice(0, k).includes(r.expect.article)).length, answerable.length);

  // Citations: before the guardrail runs, are the model's citations real articles
  // that were in the prompt? And did the answer cite the expected article?
  const withRaw = answered.concat(rows.filter((r) => r.guardrail?.action === 'withheld'));
  const validRaw = withRaw.filter((r) => r.rawCitations.length > 0 && r.rawCitations.every((id) => kbIds.has(id) && r.contextIds.includes(id)));
  const answeredAnswerable = answered.filter((r) => r.expect.type === 'answer');

  const core = rows.filter((r) => r.tags.includes('core'));

  const costs = {};
  for (const model of Object.keys(rows[0]?.costByModel ?? {})) {
    const total = rows.reduce((sum, r) => sum + r.costByModel[model], 0);
    const calls = rows.filter((r) => r.costByModel[model] > 0).length;
    costs[model] = { perQuestion: ratio(total, rows.length), perModelCall: ratio(total, calls), total };
  }
  const sortedMs = rows.map((r) => r.retrievalMs).sort((a, b) => a - b);
  const percentile = (p) => (sortedMs.length ? sortedMs[Math.min(sortedMs.length - 1, Math.floor(p * sortedMs.length))] : null);

  return {
    cases: rows.length,
    passed: rows.filter((r) => r.pass).length,
    passRate: ratio(rows.filter((r) => r.pass).length, rows.length),
    retrieval: { cases: answerable.length, hitAt1: hitAt(1), hitAt3: hitAt(3) },
    citations: {
      answers: withRaw.length,
      validity: ratio(validRaw.length, withRaw.length),
      correctness: ratio(answeredAnswerable.filter((r) => r.citations.includes(r.expect.article)).length, answeredAnswerable.length),
      guardrailInterventions: rows.filter((r) => r.guardrail).length,
    },
    refusal: {
      cases: escalateCases.length,
      recall: ratio(escalateCases.filter((r) => r.outcome === 'escalate').length, escalateCases.length),
      precision: ratio(escalated.filter((r) => r.expect.type === 'escalate').length, escalated.length),
      falseRefusalRate: ratio(answerable.filter((r) => r.outcome === 'escalate').length, answerable.length),
    },
    clarify: {
      cases: clarifyCases.length,
      accuracy: ratio(clarifyCases.filter((r) => r.pass).length, clarifyCases.length),
      unnecessaryRate: ratio(answerable.filter((r) => r.outcome === 'clarify').length, answerable.length),
    },
    answers: {
      cases: answerable.length,
      accuracy: ratio(answerable.filter((r) => r.pass).length, answerable.length),
    },
    core: {
      total: core.length,
      passed: core.filter((r) => r.pass).length,
      neverViolations: rows.filter((r) => r.neverViolated).length,
      promptChecked: core.filter((r) => r.expect.promptSays && r.outcome === 'answer').length,
      promptMissed: core.filter((r) => r.promptMissed).length,
      forbiddenInContext: core.filter((r) => (r.expect.never ?? []).some((id) => r.contextIds.includes(id) || r.options.includes(id))).length,
    },
    cost: costs,
    latencyMs: { p50: percentile(0.5), p95: percentile(0.95) },
    byTag: Object.fromEntries(
      [...new Set(rows.flatMap((r) => r.tags))].sort().map((tag) => {
        const tagged = rows.filter((r) => r.tags.includes(tag));
        return [tag, { cases: tagged.length, passed: tagged.filter((r) => r.pass).length }];
      }),
    ),
  };
}
