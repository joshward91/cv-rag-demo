import { test } from 'node:test';
import assert from 'node:assert/strict';
import { grade } from '../eval/metrics.js';

const row = (overrides) => ({ rank: [], citations: [], options: [], outcome: 'escalate', ...overrides });

test('an answer passes only when it cites the expected article', () => {
  const expect = { type: 'answer', article: 'a' };
  assert.equal(grade(row({ expect, outcome: 'answer', citations: ['a'], rank: ['a'] })).pass, true);
  assert.equal(grade(row({ expect, outcome: 'answer', citations: ['b'], rank: ['b'] })).pass, false);
});

test('ranking a forbidden article first fails the case even if the answer is right', () => {
  const expect = { type: 'answer', article: 'a', never: ['b'] };
  const graded = grade(row({ expect, outcome: 'answer', citations: ['a'], rank: ['b', 'a'] }));
  assert.equal(graded.pass, false);
  assert.equal(graded.neverViolated, true);
});

test('clarification must offer the required options and nothing outside the allowed set', () => {
  const expect = { type: 'clarify', mustInclude: ['a'], allowed: ['a', 'b'] };
  assert.equal(grade(row({ expect, outcome: 'clarify', options: ['a', 'b'] })).pass, true);
  assert.equal(grade(row({ expect, outcome: 'clarify', options: ['a', 'c'] })).pass, false);
});

test('an answer fails when the prompt does not say which "client" the user meant', () => {
  const expect = { type: 'answer', article: 'a', promptSays: 'means a contact' };
  assert.equal(grade(row({ expect, outcome: 'answer', citations: ['a'], rank: ['a'], interpretation: ['"client" means a contact'] })).pass, true);
  const missed = grade(row({ expect, outcome: 'answer', citations: ['a'], rank: ['a'], interpretation: [] }));
  assert.equal(missed.pass, false);
  assert.equal(missed.promptMissed, true);
});
