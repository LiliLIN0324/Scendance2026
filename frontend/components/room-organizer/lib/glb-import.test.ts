import { describe, expect, it } from 'vitest';
import {
  EMPTY_GLB_MESSAGE,
  NOT_GLB_MESSAGE,
  TOO_LARGE_GLB_MESSAGE,
  importBrief,
  importDisplayName,
  localGlbKey,
  validateLocalGlbPick,
} from './glb-import';
import { GLB_MAX_FILE_BYTES } from './glb-limits';

describe('本机 GLB 选文件规则', () => {
  it('只认 .glb，扩展名大小写不敏感', () => {
    expect(validateLocalGlbPick({ name: 'chair.glb', size: 1024 })).toBeNull();
    expect(validateLocalGlbPick({ name: 'CHAIR.GLB', size: 1024 })).toBeNull();
  });

  it('.gltf 给出具体原因，不静默拒绝', () => {
    expect(validateLocalGlbPick({ name: 'scene.gltf', size: 1024 })).toBe(NOT_GLB_MESSAGE);
    expect(NOT_GLB_MESSAGE).toContain('.gltf');
    expect(NOT_GLB_MESSAGE).toContain('.glb');
  });

  it('空文件单独给一句原因', () => {
    expect(validateLocalGlbPick({ name: 'empty.glb', size: 0 })).toBe(EMPTY_GLB_MESSAGE);
  });

  it('10 MB 是闭合边界：恰好 10 MB 通过，多 1 字节拒绝', () => {
    expect(validateLocalGlbPick({ name: 'ok.glb', size: GLB_MAX_FILE_BYTES })).toBeNull();
    expect(validateLocalGlbPick({ name: 'big.glb', size: GLB_MAX_FILE_BYTES + 1 })).toBe(TOO_LARGE_GLB_MESSAGE);
    expect(TOO_LARGE_GLB_MESSAGE).toContain('10 MB');
  });

  it('本机键带固定前缀，不冒充线上资产', () => {
    expect(localGlbKey('abc')).toBe('local-glb:abc');
  });

  it('名字去掉目录与扩展名，空名回退到「本机模型」', () => {
    expect(importDisplayName('C:\\models\\椅子.GLB')).toBe('椅子');
    expect(importDisplayName('/tmp/sofa.glb')).toBe('sofa');
    expect(importDisplayName(' .glb ')).toBe('本机模型');
  });

  it('导入说明同时给出尺寸、源单位与轴向处理', () => {
    expect(importBrief({ width: 1.2, depth: 0.8, height: 0.75, unit: 'm', upAxis: 'y' }))
      .toBe('1.20 m × 0.80 m × 0.75 m · 源单位米 · Y-up 原样');
    expect(importBrief({ width: 0.5, depth: 0.4, height: 1.8, unit: 'cm', upAxis: 'z' }))
      .toBe('0.50 m × 0.40 m × 1.80 m · 源单位厘米 ×0.01 · Z-up 已转 Y-up');
  });
});
