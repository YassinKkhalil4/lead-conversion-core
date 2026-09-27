import { afterEach, describe, expect, it, vi } from 'vitest';

interface FakeClient {
  statements: string[];
  released: unknown[];
  query(sql: string): Promise<{ rows: unknown[] }>;
  release(error?: unknown): void;
}

function fakeClient(failOn: Record<string, Error> = {}): FakeClient {
  return {
    statements: [],
    released: [],
    async query(sql: string) {
      this.statements.push(sql);
      const failure = failOn[sql];
      if (failure) throw failure;
      return { rows: [] };
    },
    release(error?: unknown) {
      this.released.push(error);
    },
  };
}

async function loadWithClient(client: FakeClient) {
  vi.resetModules();
  vi.doMock('../src/db/pool.js', () => ({
    pool: { connect: async () => client },
  }));
  return import('../src/db/transaction.js');
}

describe('withTransaction', () => {
  afterEach(() => {
    vi.doUnmock('../src/db/pool.js');
    vi.resetModules();
  });

  it('commits and returns the connection healthy on success', async () => {
    const client = fakeClient();
    const { withTransaction } = await loadWithClient(client);

    await expect(withTransaction(async (tx) => {
      await tx.query('SELECT 1');
      return 'done';
    })).resolves.toBe('done');

    expect(client.statements).toEqual(['BEGIN', 'SELECT 1', 'COMMIT']);
    expect(client.released).toEqual([undefined]);
  });

  it('surfaces the original error and discards the connection when ROLLBACK also fails', async () => {
    const rollbackFailure = new Error('connection terminated');
    const client = fakeClient({ ROLLBACK: rollbackFailure });
    const { withTransaction } = await loadWithClient(client);

    await expect(withTransaction(async () => {
      throw new Error('unique_violation');
    })).rejects.toThrow('unique_violation');

    expect(client.statements).toEqual(['BEGIN', 'ROLLBACK']);
    expect(client.released).toEqual([rollbackFailure]);
  });

  it('keeps the connection when ROLLBACK succeeds', async () => {
    const client = fakeClient();
    const { withTransaction } = await loadWithClient(client);

    await expect(withTransaction(async () => {
      throw new Error('business_rule_failed');
    })).rejects.toThrow('business_rule_failed');

    expect(client.released).toEqual([undefined]);
  });

  it('rollbackQuietly reports a failed ROLLBACK instead of throwing', async () => {
    const rollbackFailure = new Error('connection terminated');
    const client = fakeClient({ ROLLBACK: rollbackFailure });
    const { rollbackQuietly } = await loadWithClient(client);

    await expect(rollbackQuietly(client as never)).resolves.toBe(rollbackFailure);
    await expect(rollbackQuietly(fakeClient() as never)).resolves.toBeUndefined();
  });
});
