import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toCsv, exportFilename, type Sheet } from '../src/export/standings.js';

const sheet: Sheet = {
  name: 'Advisors',
  header: ['Position', 'Advisor', 'Store', 'Score'],
  rows: [
    [1, 'Jem', 'Toyota PA', 145.67],
    [2, 'Wes', 'Volkswagen', 102.87],
  ],
};

test('serializes header and rows with CRLF, which is what Excel expects', () => {
  assert.equal(toCsv(sheet), 'Position,Advisor,Store,Score\r\n1,Jem,Toyota PA,145.67\r\n2,Wes,Volkswagen,102.87\r\n');
});

test('quotes cells containing a comma, a quote, or a newline', () => {
  const tricky: Sheet = {
    name: 'Advisors',
    header: ['Name', 'Note'],
    rows: [
      ['Toyota, PA', 'plain'],
      ['He said "hi"', 'line\nbreak'],
    ],
  };
  const lines = toCsv(tricky).split('\r\n');
  assert.equal(lines[1], '"Toyota, PA",plain');
  assert.equal(lines[2], '"He said ""hi""","line\nbreak"');
});

test('a null cell exports as empty, not the string "null"', () => {
  const withNulls: Sheet = { name: 'Teams', header: ['Position', 'Store'], rows: [[null, 'Toyota PA']] };
  assert.equal(toCsv(withNulls).split('\r\n')[1], ',Toyota PA');
});

test('filenames slug the period label and stay filesystem-safe', () => {
  assert.equal(exportFilename('June 2026', 'advisors', 'csv'), 'we-auto-league-standings-June-2026-advisors.csv');
  assert.equal(exportFilename('Q1 / FY26', 'all', 'xlsx'), 'we-auto-league-standings-Q1-FY26-all.xlsx');
});
