import { describe, expect, it } from 'vitest';
import { assertAppliedChecksum, checksumSql } from '../scripts/migrate.js';

describe('migration checksums', () => {
  it('computes stable sha256 checksums', () => {
    expect(checksumSql('SELECT 1;\n')).toHaveLength(64);
    expect(checksumSql('SELECT 1;\n')).toBe(checksumSql('SELECT 1;\n'));
    expect(checksumSql('SELECT 1;\n')).not.toBe(checksumSql('SELECT 2;\n'));
  });

  it('accepts matching applied checksum', () => {
    const checksum = checksumSql('CREATE TABLE example(id int);');
    expect(assertAppliedChecksum({
      migrationName: '001.sql',
      storedChecksum: checksum,
      currentChecksum: checksum,
    })).toBe('valid');
  });

  it('rejects modified applied migrations', () => {
    expect(() => assertAppliedChecksum({
      migrationName: '001.sql',
      storedChecksum: checksumSql('old'),
      currentChecksum: checksumSql('new'),
    })).toThrow(/checksum mismatch/);
  });

  it('marks legacy rows without checksums for backfill', () => {
    expect(assertAppliedChecksum({
      migrationName: '001.sql',
      storedChecksum: null,
      currentChecksum: checksumSql('current'),
    })).toBe('needs_backfill');
  });
});
