import { describe, expect, it } from 'vitest';
import { Anonymizer, anonymize } from '../../src/inspect/anonymize';

const A = '3f2b8c1e-9a4d-4e2f-8b1a-0c9d8e7f6a5b';
const B = '9a8b7c6d-5e4f-4a3b-9c2d-1e0f9a8b7c6d';

describe('anonymize', () => {
  it('remaps ids consistently in keys and values, so tree links survive', () => {
    const { value } = anonymize({ current: B, nodes: { [A]: { id: A, children: [B] }, [B]: { id: B, parent: A } } });
    const v = value as { current: string; nodes: Record<string, { id: string; parent?: string; children?: string[] }> };
    const keys = Object.keys(v.nodes);
    expect(keys).not.toContain(A);
    const [ka, kb] = [v.nodes[keys[0]!]!, v.nodes[keys[1]!]!];
    expect(ka.children).toEqual([kb.id]);
    expect(kb.parent).toBe(ka.id);
    expect(v.current).toBe(kb.id);
    expect(JSON.stringify(value)).not.toMatch(/3f2b8c1e|9a8b7c6d/);
  });

  it('keeps id prefixes and strips signed URL queries', () => {
    const { value, report } = anonymize({
      file: 'file-AbCdEf1234567890',
      url: 'https://files.example.net/f/file-AbCdEf1234567890?sig=SECRET&se=2026',
    });
    expect(value).toEqual({ file: 'file-anon000000000001', url: 'https://files.example.net/f/file-anon000000000001' });
    expect(report.urls).toBe(1);
  });

  it('redacts emails and personal fields, reports free text', () => {
    const { value, report } = anonymize({ user: { email: 'me@x.io', name: 'Γιώργος Π.' }, note: 'contact me@x.io', text: 'Hello world, this is mine.' });
    const s = JSON.stringify(value);
    expect(s).not.toContain('me@x.io');
    expect(s).not.toContain('Γιώργος');
    expect((value as { note: string }).note).toBe('contact user1@example.com');
    expect((value as { user: { email: string } }).user.email).toBe('<redacted>');
    expect(report.textStrings).toBeGreaterThanOrEqual(2);
    expect(report.textKeys).toContain('text');
  });

  it('keeps machine-token names', () => {
    expect(anonymize({ author: { name: 'python' } }).value).toEqual({ author: { name: 'python' } });
  });

  it('is deterministic and shares ids across a bundle', () => {
    const a = new Anonymizer();
    const x = a.run({ id: A });
    const y = a.run({ ref: A });
    expect((x as { id: string }).id).toBe((y as { ref: string }).ref);
    expect(anonymize({ id: A }).value).toEqual(anonymize({ id: A }).value);
  });
});
