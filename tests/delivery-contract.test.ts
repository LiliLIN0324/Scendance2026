import { describe, expect, it, vi } from 'vitest';
import { handoffLimits, handoffSchema, type Handoff } from '../supabase/functions/_shared/delivery-contract.ts';

const review: Handoff = {
  ownerName: '布展组', dueDate: '2026-10-09', acceptance: '核对尺寸、位置和数量',
  status: 'review', evidenceUrls: [], evidenceNote: '',
};
const accepted: Handoff = {
  ...review, status: 'accepted', evidenceNote: '现场核对完成',
  reviewedBasis: '{"materialId":"chair","width":0.5,"x":3}',
};

describe('local handoff contract', () => {
  it('creates an empty draft without inventing identity, evidence, time or a reviewed basis', () => {
    const first = handoffSchema.parse({});
    const second = handoffSchema.parse({});
    expect(first).toEqual({
      ownerName: '', dueDate: '', acceptance: '', status: 'todo', evidenceUrls: [], evidenceNote: '',
    });
    expect(first).not.toHaveProperty('reviewedBasis');
    first.evidenceUrls.push('https://example.test/photo');
    expect(second.evidenceUrls).toEqual([]);
  });

  it.each(['todo', 'doing'] as const)('keeps incomplete %s drafts editable', status => {
    expect(handoffSchema.parse({ status, acceptance: '先摆放椅子' })).toMatchObject({
      status, ownerName: '', dueDate: '', acceptance: '先摆放椅子', evidenceNote: '',
    });
  });

  it.each(['', '0001-01-01', '1900-02-28', '2000-02-29', '2024-02-29', '2026-02-28', '2400-02-29', '2026-12-31'])
    ('accepts calendar date %s without turning it into a timestamp', dueDate => {
      expect(handoffSchema.parse({ dueDate }).dueDate).toBe(dueDate);
    });

  it.each([
    '0000-01-01', '1900-02-29', '2100-02-29', '2026-02-29', '2026-02-30', '2026-04-31',
    '2026-00-01', '2026-13-01', '2026-01-00', '2026-01-32', '2026-2-01', '2026-02-1',
    '10000-01-01', '2026/10/09', '2026-10-09T00:00:00Z',
  ])('rejects malformed or nonexistent date %s even in a draft', dueDate => {
    expect(handoffSchema.safeParse({ dueDate }).success).toBe(false);
  });

  it('normalizes surrounding form whitespace while preserving the serialized review basis', () => {
    const reviewedBasis = ' {"width":0.5,"x":3} ';
    expect(handoffSchema.parse({
      ...accepted, ownerName: ' 布展组 ', dueDate: ' 2026-10-09 ', acceptance: '\n核对尺寸\n',
      evidenceNote: '\t现场核对完成 ', evidenceUrls: [' https://example.test/photo?a=1&b=%2F '], reviewedBasis,
    })).toEqual({
      ...accepted, ownerName: '布展组', dueDate: '2026-10-09', acceptance: '核对尺寸',
      evidenceNote: '现场核对完成', evidenceUrls: ['https://example.test/photo?a=1&b=%2F'], reviewedBasis,
    });
  });

  it.each(['objectId', 'revision', 'recordedBy', 'recordedAt', 'unknownField'])
    ('rejects unknown field %s instead of silently dropping it', field => {
      const result = handoffSchema.safeParse({ ...accepted, [field]: 'untrusted' });
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error.issues.some(issue => issue.code === 'unrecognized_keys')).toBe(true);
    });

  it.each(['ready', 'done', 'missing', '', null])('rejects unsupported status %s', status => {
    expect(handoffSchema.safeParse({ status }).success).toBe(false);
  });

  it.each(['review', 'accepted'] as const)('requires all execution fields before %s', status => {
    for (const field of ['ownerName', 'dueDate', 'acceptance'] as const) {
      for (const empty of ['', ' \t\n ']) {
        const result = handoffSchema.safeParse({ ...accepted, status, [field]: empty });
        expect(result.success).toBe(false);
        if (!result.success) expect(result.error.issues.some(issue => issue.path[0] === field)).toBe(true);
      }
    }
  });

  it('lets review wait for evidence and a recorded basis, but never defaults an accepted record', () => {
    expect(handoffSchema.parse(review)).toEqual(review);
    const result = handoffSchema.safeParse({ status: 'accepted' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map(issue => issue.path[0])).toEqual([
        'ownerName', 'dueDate', 'acceptance', 'evidenceNote', 'reviewedBasis',
      ]);
    }
  });

  it('accepts a link or an evidence note without requiring both', () => {
    expect(handoffSchema.safeParse(accepted).success).toBe(true);
    expect(handoffSchema.safeParse({
      ...accepted, evidenceNote: '', evidenceUrls: ['https://example.test/photo'],
    }).success).toBe(true);
    expect(handoffSchema.safeParse({ ...accepted, evidenceNote: ' \n ', evidenceUrls: [] }).success).toBe(false);
  });

  it.each([undefined, '', ' \t\n '])('rejects accepted records with empty basis %s', reviewedBasis => {
    const result = handoffSchema.safeParse({ ...accepted, reviewedBasis });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues.some(issue => issue.path[0] === 'reviewedBasis')).toBe(true);
  });

  it('validates HTTP and HTTPS links without visiting them or rewriting their queries', () => {
    const network = vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      throw new Error('handoff validation must not fetch evidence');
    });
    try {
      const evidenceUrls = ['http://127.0.0.1:3157/photos?a=1&b=%2F#photo', 'https://example.test/照片?signature=a%2Bb'];
      expect(handoffSchema.parse({ evidenceUrls }).evidenceUrls).toEqual(evidenceUrls);
      expect(network).not.toHaveBeenCalled();
    } finally {
      network.mockRestore();
    }
  });

  it.each([
    '', 'not-a-link', '//example.test/photo', 'https://', 'https:example.test/photo',
    'javascript:alert(1)', 'data:image/png;base64,AAAA', 'blob:https://example.test/id',
    'file:///C:/photo.png', 'ftp://example.test/photo', 'https://user:secret@example.test/photo',
    'https://exa mple.test/photo', 'https://example.test/with space', 'https://exam\nple.test/photo',
  ])('rejects unsafe or non-HTTP evidence link %s', link => {
    expect(handoffSchema.safeParse({ evidenceUrls: [link] }).success).toBe(false);
  });

  it('bounds and de-duplicates evidence URLs after trimming', () => {
    const urls = Array.from({ length: handoffLimits.evidenceUrls }, (_, i) => `https://example.test/photo/${i}`);
    expect(handoffSchema.parse({ evidenceUrls: urls }).evidenceUrls).toEqual(urls);
    expect(handoffSchema.safeParse({ evidenceUrls: [...urls, 'https://example.test/extra'] }).success).toBe(false);
    expect(handoffSchema.safeParse({ evidenceUrls: [urls[0], ` ${urls[0]} `] }).success).toBe(false);
    const prefix = 'https://example.test/';
    const longest = prefix + 'a'.repeat(handoffLimits.evidenceUrl - prefix.length);
    expect(handoffSchema.safeParse({ evidenceUrls: [longest] }).success).toBe(true);
    expect(handoffSchema.safeParse({ evidenceUrls: [longest + 'a'] }).success).toBe(false);
  });

  it.each(['ownerName', 'acceptance', 'evidenceNote', 'reviewedBasis'] as const)
    ('bounds %s without truncating input or manufacturing a value', field => {
      const text = '甲'.repeat(handoffLimits[field]);
      expect(handoffSchema.parse({ [field]: text })[field]).toBe(text);
      expect(handoffSchema.safeParse({ [field]: text + '甲' }).success).toBe(false);
    });

  it('rejects coercion of names, dates, evidence and bases', () => {
    for (const invalid of [
      { ownerName: 42 }, { dueDate: 20261009 }, { acceptance: null }, { evidenceUrls: 'https://example.test' },
      { evidenceUrls: [42] }, { evidenceNote: { text: '已验收' } }, { reviewedBasis: { width: 0.5 } },
    ]) expect(handoffSchema.safeParse(invalid).success).toBe(false);
  });
});
