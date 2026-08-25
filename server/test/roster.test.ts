import { test } from 'node:test';
import assert from 'node:assert/strict';
import { includeOnStoreRoster, storeRosterIds, uniqueRosterById } from '../src/roster.js';

const store = 10;
const people = [
  { id: 1, dealershipId: store, role: 'advisor' },
  { id: 2, dealershipId: store, role: 'manager' },
  { id: 3, dealershipId: 99, role: 'advisor' },
  { id: 4, dealershipId: null, role: 'advisor' },
  { id: 5, dealershipId: null, role: 'commissioner' },
];

test('store roster includes store employees and unassigned advisors, not other stores or commissioners', () => {
  assert.deepEqual(storeRosterIds(people, store), [1, 2, 4]);
  assert.equal(includeOnStoreRoster(people[3]!, store), true);
  assert.equal(includeOnStoreRoster(people[4]!, store), false);
  assert.equal(includeOnStoreRoster(people[2]!, store), false);
});

test('a floater-widened roster does not double-count when the same id appears twice', () => {
  const duplicated = [...people, people[0]!, people[3]!];
  assert.deepEqual(
    uniqueRosterById(duplicated.filter((e) => includeOnStoreRoster(e, store))).map((e) => e.id),
    [1, 2, 4],
  );
});
