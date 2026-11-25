import { describe, it, expect } from 'vitest';
import { csvCell, toCsv } from '../../src/utils/csv.js';
import { pastDateError, toDateInput } from '../../src/utils/format.js';

describe('CSV exports are safe to open in Excel', () => {
  it('neutralises cells that would run as formulas', () => {
    expect(csvCell('=HYPERLINK("http://evil","Open")')).toBe('"\'=HYPERLINK(""http://evil"",""Open"")"');
    for (const bad of ['+1+1', '-2+3', '@SUM(A1)', '\tx', '\rx']) expect(csvCell(bad).startsWith('"\'')).toBe(true);
  });
  it('leaves ordinary text and numbers alone', () => {
    expect(csvCell('Q3 Review.pdf')).toBe('"Q3 Review.pdf"');
    expect(csvCell(42)).toBe('"42"');
    expect(csvCell(null)).toBe('""');
    expect(toCsv([['a', 'b'], ['c', '=d']])).toBe('"a","b"\r\n"c","\'=d"');
  });
});

describe('date fields', () => {
  it('rejects past dates, including half-typed years', () => {
    expect(pastDateError('')).toBeNull();
    expect(pastDateError(toDateInput(Date.now()))).toBeNull(); // today (ends tonight) is fine
    expect(pastDateError(toDateInput(Date.now() + 5 * 864e5))).toBeNull();
    expect(pastDateError(toDateInput(Date.now() - 864e5))).toBe('Choose today or a later date');
    for (const partial of ['0002-05-01', '0020-05-01', '0202-05-01']) expect(pastDateError(partial)).toBe('Choose today or a later date');
  });
});
