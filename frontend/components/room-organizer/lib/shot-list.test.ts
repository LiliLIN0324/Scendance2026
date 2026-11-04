import { describe, expect, it } from 'vitest';
import { ALBUM_SHOTS, albumBaseName, renderAlbumHtml } from './shot-list';

describe('album shot list', () => {
  it('uses four stable presets in a fixed order', () => {
    expect(ALBUM_SHOTS.map(shot => shot.id)).toEqual(['iso', 'top', 'front', 'corner']);
    expect(ALBUM_SHOTS.map(shot => shot.filePart)).toEqual(['01-整体', '02-俯视', '03-正面', '04-对角']);
  });

  it('builds one naming base and strips characters that break file names', () => {
    expect(albumBaseName('西湖 共创/方案')).toBe('西湖_共创方案_v0_效果图');
    expect(albumBaseName('   ')).toBe('未命名活动_v0_效果图');
    expect(albumBaseName('方案', 'v3')).toBe('方案_v3_效果图');
  });

  it('inlines every shot, escapes labels, and adds no script', () => {
    const html = renderAlbumHtml({
      projectName: '西湖共创 <A>',
      generatedAt: '2026-11-04T10:00:00.000Z',
      shots: [
        { label: '整体', dataUrl: 'data:image/png;base64,AAA' },
        { label: '俯视 & <b>', dataUrl: 'data:image/png;base64,BBB' },
      ],
    });
    expect(html).toContain('西湖共创 &lt;A&gt;');
    expect(html).toContain('俯视 &amp; &lt;b&gt;');
    expect(html).toContain('data:image/png;base64,AAA');
    expect(html).toContain('data:image/png;base64,BBB');
    expect(html).toContain('共 2 个机位');
    expect(html).not.toContain('<script');
    expect(html).toContain('@page { size: A4 portrait; margin: 12mm; }');
  });
});
