import { Prisma } from '@prisma/client';
import { afterAll, beforeEach } from 'vitest';
import { prisma } from '../../src/lib/prisma';

/// Table list derived from Prisma's own metadata rather than hand-written,
/// so a newly added model is truncated automatically instead of silently
/// leaking state between tests.
const tableNames = Prisma.dmmf.datamodel.models
  .map((model) => `"${model.dbName ?? model.name}"`)
  .join(', ');

async function truncateAll(): Promise<void> {
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tableNames} RESTART IDENTITY CASCADE;`);
}

beforeEach(async () => {
  await truncateAll();
});

afterAll(async () => {
  await prisma.$disconnect();
});
