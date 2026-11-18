import { describe, expect, it } from 'vitest';
import { sitePlanDataSchema, type PlanPoint } from '../../../../supabase/functions/_shared/site-plan';
import { CN_REPLICA_CASES, REPLICA_CASES } from './replica-cases';
import { expandReplicaSpec, type ReplicaCaseSpec } from './replica-kit';
import { resolveFacilityTemplate } from './plan-facility-catalog';
import { DEFAULT_SCOPE_MARGIN_M, expandRect } from './outdoor-design-scope';
import { gcj02ToWgs84, isInGcjOffsetRegion, wgs84ToGcj02 } from './geo-coords';
import { planPointToPixel, planMetersPerPixel } from './outdoor-plan-canvas';
import { reportFrameOf } from './replica-report-frame';

/** 射线法：点是否在多边形内（边界粗略即可——复刻数据只需保证实体都落在边界内）。 */
function pointInRing(p: PlanPoint, ring: PlanPoint[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

describe('replica-cases（OnePlan 经典案例复刻）', () => {
  it('复刻清单齐全（45 个唯一案例）且 id 唯一', () => {
    expect(REPLICA_CASES.length).toBe(45);
    expect(new Set(REPLICA_CASES.map(c => c.id)).size).toBe(REPLICA_CASES.length);
  });

  it('每案过 schema 严格校验', () => {
    for (const replica of REPLICA_CASES) {
      const plan = replica.buildPlan();
      expect(sitePlanDataSchema.parse(plan), `${replica.id} schema`).toBeTruthy();
    }
  });

  // 2026-11-17 用户：「案例库画完了用地红线，外面没有对应的白色框」。
  // 病根是案例只生成了 boundary、没写 designScope，画布按 designScope>=3 才画白框，
  // 于是打开经典案例看不见框外那圈压暗与四角白 L，和手画红线的行为对不上。
  it('每案都带设计范围：红线外接矩形四边各外扩 20 m（案例也有那只白框）', () => {
    for (const replica of REPLICA_CASES) {
      const plan = replica.buildPlan();
      const scope = plan.designScope ?? [];
      expect(scope.length, `${replica.id} 缺 designScope`).toBeGreaterThanOrEqual(3);
      const xs = plan.boundary.map(p => p.x);
      const ys = plan.boundary.map(p => p.y);
      const expectScope = expandRect(plan.boundary, DEFAULT_SCOPE_MARGIN_M);
      // 与「画好红线默认=设计范围」同一套几何：四个角正好各边外扩 20 m。
      const r2 = (n: number) => Math.round(n * 100) / 100;
      const ringOf = (ring: readonly { x: number; y: number }[]) => ring.map(p => [r2(p.x), r2(p.y)]);
      expect(ringOf(scope), replica.id).toEqual(ringOf(expectScope));
      const margin = DEFAULT_SCOPE_MARGIN_M;
      expect(Math.min(...scope.map(p => p.x))).toBeCloseTo(Math.min(...xs) - margin, 5);
      expect(Math.max(...scope.map(p => p.x))).toBeCloseTo(Math.max(...xs) + margin, 5);
      expect(Math.min(...scope.map(p => p.y))).toBeCloseTo(Math.min(...ys) - margin, 5);
      expect(Math.max(...scope.map(p => p.y))).toBeCloseTo(Math.max(...ys) + margin, 5);
    }
  });

  it('每案带案例锚点与流线；纯路线图不补造设施', () => {
    for (const replica of REPLICA_CASES) {
      const plan = replica.buildPlan();
      expect(plan.anchor?.source, replica.id).toBe('preset');
      expect(plan.boundary.length).toBeGreaterThanOrEqual(3);
      const routeOnly = replica.id === 'buffalo-marathon-weekend' || replica.id === 'festival-foods-11-running-events-on-the-same-day';
      expect(plan.zones.length, `${replica.id} zones`).toBeGreaterThanOrEqual(routeOnly ? 0 : 3);
      expect(plan.facilities.length, `${replica.id} facilities`).toBeGreaterThanOrEqual(routeOnly ? 0 : 5);
      expect(plan.routes.length, `${replica.id} routes`).toBeGreaterThanOrEqual(1);
      expect(plan.nodes.length, `${replica.id} nodes`).toBeGreaterThanOrEqual(1);
    }
  });

  it('boundary 包住分区、设施、节点和全部路线顶点', () => {
    for (const replica of REPLICA_CASES) {
      const plan = replica.buildPlan();
      for (const zone of plan.zones) {
        for (const p of zone.polygon) {
          expect(pointInRing(p, plan.boundary), `${replica.id} zone ${zone.name} 顶点 (${p.x},${p.y}) 越界`).toBe(true);
        }
      }
      for (const facility of plan.facilities) {
        expect(pointInRing(facility.position, plan.boundary), `${replica.id} facility ${facility.name} 越界`).toBe(true);
      }
      for (const node of plan.nodes) {
        expect(pointInRing(node.position, plan.boundary), `${replica.id} node ${node.name} 越界`).toBe(true);
      }
      for (const route of plan.routes) for (const point of route.points) {
        expect(pointInRing(point, plan.boundary), `${replica.id} route ${route.name} 越界`).toBe(true);
      }
    }
  });

  it('全部 facility.templateId 能解析出模板（名字/占地进清单与图例）', () => {
    for (const replica of REPLICA_CASES) {
      const plan = replica.buildPlan();
      for (const facility of plan.facilities) {
        expect(resolveFacilityTemplate(facility.templateId), `${replica.id} templateId ${facility.templateId} 不可解析`).not.toBeNull();
      }
    }
  });

  it('设施 zoneId 引用完整（若有绑定则指向存在的分区）', () => {
    for (const replica of REPLICA_CASES) {
      const plan = replica.buildPlan();
      const zoneIds = new Set(plan.zones.map(zone => zone.id));
      for (const facility of plan.facilities) {
        if (facility.zoneId) expect(zoneIds.has(facility.zoneId), `${replica.id} facility ${facility.name} zoneId 悬空`).toBe(true);
      }
    }
  });

  it('用户确认的视图与几何分开保存，全部确认位置保留到案例入口', () => {
    const confirmed = REPLICA_CASES.filter(c => c.confirmedView);
    expect(confirmed).toHaveLength(43);
    for (const replica of confirmed) {
      const view = replica.confirmedView!;
      expect(replica.buildPlan().anchor).toMatchObject({ lng: view.lng, lat: view.lat });
      expect(Number.isFinite(view.rotationDeg)).toBe(true);
      expect(view.zoom).toBeGreaterThan(0);
    }
    const franklin = REPLICA_CASES.find(c => c.id === 'franklins-gardens-northampton-saints-stadium')!;
    expect(franklin.confirmedView).toEqual({ lng: -0.919582, lat: 52.239493, zoom: 17.75, rotationDeg: 129 });
    expect(franklin.rotationDeg).toBe(231);
    for (const id of ['buffalo-marathon-weekend', 'festival-foods-11-running-events-on-the-same-day']) {
      const plan = REPLICA_CASES.find(c => c.id === id)!.buildPlan();
      expect(plan.facilities).toHaveLength(0);
      expect(plan.zones).toHaveLength(0);
    }
  });

  it('错位案例用独立的原图对应点约束几何，不把观察角直接反推为几何角', () => {
    const ids = ['northern-nevada-pride', 'banbury-town-council-coronation-events', 'olney-maryland-national-night-out', 'basildon-pride', 'fire-in-the-mountain', 'trunk-or-treat', 'winterskol'];
    for (const id of ids) {
      const replica = REPLICA_CASES.find(c => c.id === id)!;
      const registration = replica.sourceRegistration!;
      expect(registration, id).toBeTruthy();
      expect(registration.controlPoints, id).toHaveLength(3);
      expect(replica.rotationDeg, id).toBe(registration.geometryRotationDeg);
      const anchor = replica.buildPlan().anchor!;
      const rad = -registration.geometryRotationDeg * Math.PI / 180;
      const viewport = { lng: anchor.lng, lat: anchor.lat, zoom: 19, canvasW: 1000, canvasH: 1000 };
      const world = 256 * 2 ** viewport.zoom;
      const worldPoint = (lng: number, lat: number) => ({ x: (lng + 180) / 360 * world, y: (1 - Math.asinh(Math.tan(lat * Math.PI / 180)) / Math.PI) / 2 * world });
      const origin = worldPoint(anchor.lng, anchor.lat);
      for (const point of registration.controlPoints) {
        const x = (point.imagePx[0] - registration.imageAnchorPx[0]) * registration.metersPerPixel;
        const y = (registration.imageAnchorPx[1] - point.imagePx[1]) * registration.metersPerPixel;
        const actual = planPointToPixel({ x: x * Math.cos(rad) - y * Math.sin(rad), y: x * Math.sin(rad) + y * Math.cos(rad) }, viewport);
        const expected = worldPoint(point.lng, point.lat);
        const residual = Math.hypot(actual.x - (expected.x - origin.x + 500), actual.y - (expected.y - origin.y + 500)) * planMetersPerPixel(viewport);
        expect(residual, `${id} 对应点偏离真实底图`).toBeLessThan(point.residualM + 0.05);
      }
    }
    expect(REPLICA_CASES.find(c => c.id === 'banbury-town-council-coronation-events')!.confirmedView!.rotationDeg).toBe(98);
    expect(REPLICA_CASES.find(c => c.id === 'fire-in-the-mountain')!.confirmedView!.rotationDeg).toBe(0);
  });

  it('Scotiabank 冰球日（首案）细节钉住', () => {
    const replica = REPLICA_CASES.find(c => c.id === 'scotiabank-hockey-day-canada')!;
    const plan = replica.buildPlan();
    expect(plan.anchor).toEqual({ lng: -123.370099, lat: 48.423153, crs: 'gcj-02', source: 'preset' });
    expect(replica.rotationDeg).toBeCloseTo(77.930692, 6);
    expect(plan.routes.slice(0, 3).every(r => r.kind === 'pedestrian' && r.color === '#f2c744')).toBe(true);
    expect(plan.routes[3]).toMatchObject({ kind: 'vehicle', carrier: 'vehicle' });
    expect(plan.zones.length).toBe(9);
    expect(plan.facilities.length).toBe(60);
    expect(plan.nodes.length).toBe(3);
    expect(plan.facilities.find(f => f.name === '53 英尺拖车 A')?.size).toEqual({ width: 12, depth: 5 });
    expect(plan.facilities.find(f => f.name === '40 英尺集装箱')?.size).toEqual({ width: 12, depth: 2.4 });
    expect(plan.facilities.find(f => f.name === '40×50 公共帐篷')?.size).toEqual({ width: 12.192, depth: 15.24 });
    const toilets = plan.facilities.filter(f => f.name.startsWith('Portal Toilet（双位）'));
    expect(toilets).toHaveLength(2);
    expect(Math.hypot(toilets[1].position.x - toilets[0].position.x, toilets[1].position.y - toilets[0].position.y)).toBeCloseTo(2.6, 1);
    // Canada is outside the GCJ offset region: both adapters must leave the anchor unchanged.
    expect(gcj02ToWgs84(-123.370099, 48.423153)).toEqual({ lng: -123.370099, lat: 48.423153 });
    expect(wgs84ToGcj02(-123.370099, 48.423153)).toEqual({ lng: -123.370099, lat: 48.423153 });
  });

  it('row / grid / scatter 均按声明数量展开，米制尺寸与步距不再次缩放', () => {
    const spec: ReplicaCaseSpec = {
      slug: 'placement-probe', title: 'probe', category: 'Festivals', region: 'Europe', refImage: '', refLink: '',
      anchor: { lng: 0, lat: 0 }, zones: [], routes: [], nodes: [],
      facilities: [
        { templateId: 'oneplan:scale:tent', name: 'row', size: { width: 12, depth: 5 }, placement: { kind: 'row', x: 0, y: 0, count: 2, dx: 2.6 } },
        { templateId: 'oneplan:scale:tent', name: 'grid', placement: { kind: 'grid', x: 10, y: 10, rows: 2, cols: 2, dx: 9, dy: 10 } },
        { templateId: 'oneplan:scale:tent', name: 'scatter', placement: { kind: 'scatter', at: [[30, 30], [40, 40]] } },
      ],
    };
    const plan = expandReplicaSpec(spec);
    expect(plan.facilities).toHaveLength(8);
    expect(plan.facilities.slice(0, 2).map(f => [f.position, f.size])).toEqual([
      [{ x: 0, y: 0 }, { width: 12, depth: 5 }], [{ x: 2.6, y: 0 }, { width: 12, depth: 5 }],
    ]);
    expect(plan.facilities.slice(2, 6).map(f => f.position)).toEqual([{ x: 10, y: 10 }, { x: 19, y: 10 }, { x: 10, y: 20 }, { x: 19, y: 20 }]);
    expect(plan.facilities.slice(6).map(f => f.position)).toEqual([{ x: 30, y: 30 }, { x: 40, y: 40 }]);
  });

  // 2026-11-18 用户：「我不是引入了很多海外的案例吗，在界面上汉化」——
  // 界面主标题/分类/区域一律中文；原文英文名留在 titleEn/categoryEn/regionEn 供溯源。
  it('海外 45 案的界面标签全部汉化，且不丢 OnePlan 原名', () => {
    for (const replica of REPLICA_CASES) {
      expect(replica.title, `${replica.id} 标题`).toMatch(/[\u4e00-\u9fff]/);
      expect(replica.category, `${replica.id} 分类`).toMatch(/[\u4e00-\u9fff]/);
      expect(replica.region, `${replica.id} 区域`).toMatch(/[\u4e00-\u9fff]/);
      expect(replica.categoryEn, `${replica.id} 分类原文`).toBeTruthy();
      expect(replica.regionEn, `${replica.id} 区域原文`).toBeTruthy();
      expect(replica.titleEn, `${replica.id} 原案名`).toBeTruthy();
    }
    expect(REPLICA_CASES[0].title).toBe('Scotiabank 加拿大冰球日');
    expect(REPLICA_CASES[0].category).toBe('节庆');
    expect(REPLICA_CASES[0].region).toBe('北美');
  });

  // 2026-11-18 用户：「我们的官网也有很多中国的案例，尝试按照海外案例的逻辑去做做看」。
  // 国内案与海外案同构：真实锚点 + 拟设区块/物料/流线；口径是官网自己的「拟设、非实测」。
  it('官网中国案例与海外案同构：真实锚点、拟设内容、过 schema', () => {
    expect(CN_REPLICA_CASES.length).toBeGreaterThanOrEqual(12);
    for (const replica of CN_REPLICA_CASES) {
      expect(replica.origin, replica.id).toBe('cn');
      const plan = replica.buildPlan();
      expect(sitePlanDataSchema.parse(plan), `${replica.id} schema`).toBeTruthy();
      expect(plan.anchor?.source, replica.id).toBe('preset');
      expect(isInGcjOffsetRegion(plan.anchor!.lng, plan.anchor!.lat), `${replica.id} 应在国内锚点`).toBe(true);
      expect(plan.routes.length, `${replica.id} 至少要一条流线`).toBeGreaterThanOrEqual(1);
      for (const facility of plan.facilities) {
        expect(resolveFacilityTemplate(facility.templateId), `${replica.id} ${facility.templateId}`).not.toBeNull();
      }
      expect(replica.locationNote, `${replica.id} 需要写明官网出处与拟设口径`).toContain('非现场实测');
      // 补全门槛（2026-11-18 用户：「中国的案例库」要和海外一样完整）：
      // 分区≥3、物料≥5、流线≥2（含一条后勤）、节点≥2（入口 + 后勤口）。
      expect(plan.zones.length, `${replica.id} 分区`).toBeGreaterThanOrEqual(3);
      expect(plan.facilities.length, `${replica.id} 物料`).toBeGreaterThanOrEqual(5);
      expect(plan.routes.length, `${replica.id} 流线`).toBeGreaterThanOrEqual(2);
      expect(plan.routes.some(r => r.kind === 'service'), `${replica.id} 要有一条后勤线`).toBe(true);
      expect(plan.nodes.length, `${replica.id} 出入口节点`).toBeGreaterThanOrEqual(2);
      // 对比报告左幅用的官网侧平面（轮廓 + 官网拟设），必须随案带着走。
      expect(replica.officialPlan, `${replica.id} 需要官网侧平面数据`).toBeTruthy();
      // 饮水点/第二导视必须在立面外侧：往里推会压在建筑轮廓上（2026-11-18 对账发现后固定）。
      const outlineZone = plan.zones.find(z => z.name.includes('官网描图'));
      if (outlineZone) {
        for (const name of ['拟放 · 饮水点', '拟放 · 导视牌 B']) {
          const f = plan.facilities.find(x => x.name === name);
          expect(f, `${replica.id} 缺 ${name}`).toBeTruthy();
          expect(pointInRing(f!.position, outlineZone.polygon), `${replica.id} ${name} 应在立面外侧`).toBe(false);
        }
      }
      expect(
        replica.officialPlan!.areas.length + replica.officialPlan!.seeds.length,
        `${replica.id} 官网平面至少要有轮廓或拟设内容`,
      ).toBeGreaterThan(0);
    }
  });

  // 2026-11-18 用户：「我的官网已经描过轮廓线了，不用再搞一次」——
  // 只有轮廓的案直接拿官网描图当底，不再自己描；场外起手位按轮廓最长边派生。
  it('只有轮廓的中国案例直接复用官网描图，不重新描轮廓', () => {
    const outlineIds = [
      'cn-canton-fair-139', 'cn-ciie-9', 'cn-baima-20', 'cn-aosen-music-festival',
      'cn-wuzhen-internet-light', 'cn-yiwu-fair-31', 'cn-plastics-expo-27', 'cn-taizhou-icec',
    ];
    for (const id of outlineIds) {
      const replica = CN_REPLICA_CASES.find(c => c.id === id);
      expect(replica, id).toBeTruthy();
      const plan = replica!.buildPlan();
      expect(replica!.locationNote, id).toContain('官网已描好的底图');
      // 轮廓区 + 场外集结区 + 安检区；导视、安检棚、服务台等物料；
      // 入场线 + 后勤补给线；主场入口 + 后勤口。
      expect(plan.zones.map(z => z.name)[0], id).toContain('官网描图');
      expect(plan.zones[0].semantic, id).toBe('indoor');
      expect(plan.zones[0].polygon.length, id).toBeGreaterThanOrEqual(3);
      expect(plan.facilities.map(f => f.name), id).toContain('拟放 · 导视牌');
      expect(plan.routes[0].name, id).toBe('拟设 · 观众入场线');
      expect(plan.nodes.map(n => n.name), id).toContain('待核 · 主场入口');
    }
  });

  it('左右同口径取景：按官网轮廓取景，右幅不再按整套内容缩小', () => {
    for (const replica of CN_REPLICA_CASES) {
      // 与报告页同一口径：有轮廓用轮廓，没有轮廓（盐官）用官网拟设点。
      const ring = replica.officialPlan?.areas[0]?.polygon
        ?? replica.officialPlan?.seeds.flatMap(s => s.points);
      expect(ring, `${replica.id} 缺官网取景数据`).toBeTruthy();
      const frame = reportFrameOf(ring!)!;
      const xs = ring!.map(p => p[0]);
      const ys = ring!.map(p => p[1]);
      const outlineSpan = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
      expect(frame.spanM, `${replica.id} 取景框边长`).toBeCloseTo(outlineSpan * 1.18, 6);
      expect(frame.cx, `${replica.id} 取景中心 x`).toBeCloseTo((Math.min(...xs) + Math.max(...xs)) / 2, 6);
      expect(frame.cy, `${replica.id} 取景中心 y`).toBeCloseTo((Math.min(...ys) + Math.max(...ys)) / 2, 6);
    }
    // 杭州植物园：整套内容的包围盒明显大于官网轮廓框——旧口径按内容取景才会缩成 3.9×。
    const yuquan = CN_REPLICA_CASES.find(c => c.id === 'cn-yuquan-chrysanthemum')!;
    const plan = yuquan.buildPlan();
    const pts = [
      ...plan.boundary,
      ...plan.zones.flatMap(z => z.polygon),
      ...plan.facilities.map(f => f.position),
    ];
    const spanAll = Math.max(
      Math.max(...pts.map(p => p.x)) - Math.min(...pts.map(p => p.x)),
      Math.max(...pts.map(p => p.y)) - Math.min(...pts.map(p => p.y)),
    );
    const frame = reportFrameOf(yuquan.officialPlan!.areas[0].polygon)!;
    expect(spanAll / frame.spanM, '内容跨度应明显大于取景框').toBeGreaterThan(2);
  });

  it('国内案例按官网 cite 走 WGS-84 → GCJ-02，锚点换算可复现', () => {
    const yuquan = CN_REPLICA_CASES.find(c => c.id === 'cn-yuquan-chrysanthemum')!;
    // assets/site-cases.mjs：cite 120.11608,30.25723。
    const gcj = wgs84ToGcj02(120.11608, 30.25723);
    const anchor = yuquan.buildPlan().anchor!;
    expect(anchor.lng).toBeCloseTo(gcj.lng, 5);
    expect(anchor.lat).toBeCloseTo(gcj.lat, 5);
    // 反算回 WGS-84 应回到官网 cite（±1 m 量级），证明没有把两套坐标混用。
    const back = gcj02ToWgs84(anchor.lng, anchor.lat);
    expect(back.lng).toBeCloseTo(120.11608, 4);
    expect(back.lat).toBeCloseTo(30.25723, 4);
  });

  it('rotationDeg 把局部米制坐标整体旋到真实方位', () => {
    const base = { slug: 'rot-probe', title: 'probe', category: 'Festivals', region: 'Europe', refImage: 'x.png', refLink: '', anchor: { lng: 0, lat: 0 }, routes: [], nodes: [] };
    const spec: ReplicaCaseSpec = {
      ...base,
      rotationDeg: 90,
      zones: [{ name: 'probe', semantic: 'reserved' as const, color: '#000000', rect: { cx: 0, cy: 0, w: 10, h: 10 } }],
      facilities: [{ templateId: 'oneplan:icon:bar', name: 'p', placement: { kind: 'single' as const, x: 0, y: 10 }, size: { width: 1, depth: 1 } }],
    };
    const plan = expandReplicaSpec(spec);
    // 图上「向北 10 m」在 90° 旋转后应变成「向东 10 m」
    expect(plan.facilities[0].position.x).toBeCloseTo(10, 6);
    expect(plan.facilities[0].position.y).toBeCloseTo(0, 6);
    expect(plan.facilities[0].rotationDeg).toBeCloseTo(270, 6);
  });
});
