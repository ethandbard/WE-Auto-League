import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRoster } from '../src/ingestion/roster.js';

const header = 'Name,Email,Alias,Role,Store,Hire Date';

test('parses a plain roster row', () => {
  const { rows, errors } = parseRoster(`${header}\nJem Bard,JEM@example.com,Jem,Advisor,Toyota PA,2024-03-01`);
  assert.deepEqual(errors, []);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], {
    line: 2,
    name: 'Jem Bard',
    email: 'jem@example.com',
    alias: 'Jem',
    role: 'advisor',
    storeName: 'Toyota PA',
    hireDate: '2024-03-01',
  });
});

test('an absent column states no opinion, so the stored value survives the import', () => {
  // The address-collection file from TODO 1b: without this, importing it would
  // demote every manager to advisor and move every advisor to unassigned.
  const { rows, errors } = parseRoster('Name,Email\nWes Side,wes@example.com');
  assert.deepEqual(errors, []);
  assert.equal(rows[0]!.role, undefined);
  assert.equal(rows[0]!.storeName, undefined);
  assert.equal(rows[0]!.alias, undefined);
  assert.equal(rows[0]!.hireDate, undefined);
});

test('a present column with a blank cell is a stated value, not an absent one', () => {
  const { rows, errors } = parseRoster(`${header}\nWes Side,wes@example.com,,,,`);
  assert.deepEqual(errors, []);
  // Blank Alias clears it and a blank Store means floater, but a blank Role has
  // no meaning to state and a blank Hire Date must not wipe the stored one.
  assert.equal(rows[0]!.alias, null);
  assert.equal(rows[0]!.storeName, null);
  assert.equal(rows[0]!.role, undefined);
  assert.equal(rows[0]!.hireDate, undefined);
});

test('accepts TSV, which is what a spreadsheet paste delivers', () => {
  const { rows, errors } = parseRoster('Name\tEmail\nJem Bard\tjem@example.com');
  assert.deepEqual(errors, []);
  assert.equal(rows[0]!.email, 'jem@example.com');
});

test('matches header aliases and role synonyms case-insensitively', () => {
  const { rows, errors } = parseRoster('Employee Name,Work Email,Title,Dealership\nWes Side,wes@example.com,Service Manager,VW');
  assert.deepEqual(errors, []);
  assert.equal(rows[0]!.role, 'manager');
  assert.equal(rows[0]!.storeName, 'VW');
});

test('a blank store is a floater, not an error — dealershipId stays null downstream', () => {
  const { rows, errors } = parseRoster(`${header}\nFloater Fred,fred@example.com,,advisor,,`);
  assert.deepEqual(errors, []);
  assert.equal(rows[0]!.storeName, null);
});

test('rejects a bad address, an unknown role, and a duplicate email, naming the row each time', () => {
  const { rows, errors } = parseRoster(
    `${header}\n` +
      'No At Sign,not-an-email,,advisor,Toyota PA,\n' +
      'Bad Role,bad@example.com,,Head Chef,Toyota PA,\n' +
      'First,dup@example.com,,advisor,Toyota PA,\n' +
      'Second,DUP@example.com,,advisor,Toyota PA,',
  );
  // Rows 2, 3, and 5 are each rejected; row 4 is the one clean row and still parses.
  assert.equal(rows.length, 1, 'a bad row does not abort the rows around it');
  assert.equal(rows[0]!.email, 'dup@example.com');
  assert.equal(errors.length, 3);
  assert.match(errors[0]!, /Row 2 \(No At Sign\).*not a valid email/);
  assert.match(errors[1]!, /Row 3 \(Bad Role\).*Head Chef/);
  assert.match(errors[2]!, /Row 5 \(Second\).*more than once/);
});

test('normalizes the hire-date forms a spreadsheet actually produces', () => {
  const { rows, errors } = parseRoster(
    `${header}\n` +
      'Iso Ivy,ivy@example.com,,advisor,,2024-03-01\n' +
      // workbook.ts stringifies a real .xlsx date cell to a full ISO timestamp.
      'Xlsx Xena,xena@example.com,,advisor,,2024-03-01T00:00:00.000Z\n' +
      'Slash Sam,sam@example.com,,advisor,,3/1/2024',
  );
  assert.deepEqual(errors, []);
  assert.deepEqual(
    rows.map((r) => r.hireDate),
    ['2024-03-01', '2024-03-01', '2024-03-01'],
  );
});

test('rejects an unparseable hire date rather than letting Postgres reject it', () => {
  const { rows, errors } = parseRoster(`${header}\nVague Vic,vic@example.com,,advisor,,March 2024`);
  assert.equal(rows.length, 0);
  assert.match(errors[0]!, /Row 2 \(Vague Vic\).*is not a hire date/);
});

test('rejects a well-formed date that is not on the calendar', () => {
  const { errors } = parseRoster(`${header}\nLeap Lou,lou@example.com,,advisor,,2025-02-30`);
  assert.match(errors[0]!, /not a real calendar date/);
});

test('a missing Name or Email column is a file-level error, not 45 row errors', () => {
  const { rows, errors } = parseRoster('Name,Store\nJem Bard,Toyota PA');
  assert.equal(rows.length, 0);
  assert.equal(errors.length, 1);
  assert.match(errors[0]!, /No "Email" column/);
});

test('a header with no data rows is rejected rather than silently importing nothing', () => {
  assert.match(parseRoster(header).errors[0]!, /at least one data row/);
});

test('fully blank lines are skipped, not reported', () => {
  const { rows, errors } = parseRoster(`${header}\nJem Bard,jem@example.com,,,,\n,,,,,\n`);
  assert.deepEqual(errors, []);
  assert.equal(rows.length, 1);
});
