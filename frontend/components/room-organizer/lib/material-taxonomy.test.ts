import { describe, expect, it } from 'vitest';
import {
  CROWD_GROUP_LABEL,
  isMaterialGroupLabel,
  materialGroupLabel,
  matchesMaterialGroup,
} from './material-taxonomy';

describe('material-taxonomy（素材家族 → 基础设施分类折叠）', () => {
  describe('materialGroupLabel', () => {
    it('空家族回落「其他」；已知家族折叠到类目；未知家族原样保留', () => {
      expect(materialGroupLabel('')).toBe('其他');
      expect(materialGroupLabel('audio')).toBe('视听设备');
      expect(materialGroupLabel('seating')).toBe('家具');
      expect(materialGroupLabel('stage')).toBe('景点');
      expect(materialGroupLabel('people')).toBe(CROWD_GROUP_LABEL);
      expect(materialGroupLabel('unknown-xyz')).toBe('unknown-xyz');
    });
  });

  describe('matchesMaterialGroup', () => {
    it('空筛选全过；家族直等或折叠后类目相等都命中', () => {
      expect(matchesMaterialGroup('audio', '')).toBe(true);
      expect(matchesMaterialGroup('audio', 'audio')).toBe(true);
      expect(matchesMaterialGroup('audio', '视听设备')).toBe(true);
      expect(matchesMaterialGroup('food', '家具')).toBe(false);
    });
  });

  describe('isMaterialGroupLabel', () => {
    it('只认类目标签，原始家族名不算类目', () => {
      expect(isMaterialGroupLabel('视听设备')).toBe(true);
      expect(isMaterialGroupLabel(CROWD_GROUP_LABEL)).toBe(true);
      expect(isMaterialGroupLabel('audio')).toBe(false);
      expect(isMaterialGroupLabel('不存在的类目')).toBe(false);
    });
  });
});
