import { describe, expect, it } from 'vitest';
import { parseUsdaCsv } from '../csv';

describe('parseUsdaCsv', () => {
  it('parses quoted fields containing commas', () => {
    const csv = 'fdc_id,description\n123,"Soup, chicken, with rice"\n456,"Cheese, cheddar"\n';
    const rows = parseUsdaCsv(Buffer.from(csv), 'food.csv', ['fdc_id', 'description']);

    expect(rows).toEqual([
      { fdc_id: '123', description: 'Soup, chicken, with rice' },
      { fdc_id: '456', description: 'Cheese, cheddar' },
    ]);
  });

  it('strips a UTF-8 BOM from the header', () => {
    const csv = '﻿fdc_id,description\n1,Apple\n';
    const rows = parseUsdaCsv(Buffer.from(csv), 'food.csv', ['fdc_id', 'description']);
    expect(rows).toEqual([{ fdc_id: '1', description: 'Apple' }]);
  });

  it('throws naming the file and the missing column when a required column is absent', () => {
    const csv = 'fdc_id,name\n1,Apple\n';
    expect(() => parseUsdaCsv(Buffer.from(csv), 'nutrient.csv', ['fdc_id', 'description'])).toThrow(
      /nutrient\.csv.*description/s,
    );
  });
});
