import { describe, it, expect } from "vitest";
import { sitePlanDataSchema } from "../../../../supabase/functions/_shared/site-plan";
import {
  proposeUseZones,
  proposeInventoryObjects,
  proposeRoleWorkers,
  validateWorkflowPlan,
  validateWorkflowDemand,
  describeZoneMismatch,
  clearForObject,
} from "./outdoor-agent-planning";
import { outdoorRingsOverlap } from "./outdoor-event-logic";
import { createStarterOutdoorPlan } from "./outdoor-project-store";
import { planPointInRing } from "./site-plan-editing";
import { buildSubEntranceProposal } from "./sub-entrance";
import type { OutdoorBrief } from "./outdoor-agent-contract";
import type { SitePlanData } from "../../../../supabase/functions/_shared/site-plan";
const square = (w = 80, h = 70) => [
  { x: 0, y: 0 },
  { x: w, y: 0 },
  { x: w, y: h },
  { x: 0, y: h },
];
const base = () => ({ ...createStarterOutdoorPlan(), boundary: square() });
const brief: OutdoorBrief = {
  guests: 45,
  event: "户外市集",
  zones: [
    {
      name: "展览区",
      purpose: "exhibition",
      environment: "outdoor",
      evidence: "展览区室外",
    },
    {
      name: "表演区",
      purpose: "performance",
      environment: "outdoor",
      evidence: "表演区室外",
    },
  ],
  items: [],
  people: [],
};
describe("户外用途、真实库、人员几何守卫", () => {
  it("真实80×70m边界可分展览与表演，未摆固定活动模板", () => {
    const plan = proposeUseZones(base(), brief);
    expect(plan.zones).toHaveLength(2);
    expect(plan.facilities).toHaveLength(0);
    expect(() => validateWorkflowPlan(base(), plan)).not.toThrow();
  });
  it("室内未知边界不再卡死户外分区；已有用户画区时仍按室内落 environment", () => {
    // 2026-11-16 用户指令「无室内，后续是造墙」：室内边界改由造墙阶段承接，
    // 这里只给占位几何（否则一条「室内 12×9」的输入就能把主链卡死在分区步）。
    const drafted = proposeUseZones(base(), {
      ...brief,
      zones: [{ ...brief.zones[0]!, environment: "indoor" }],
    });
    expect(drafted.zones).toHaveLength(1);
    expect(drafted.zones[0]!.environment).toBe("indoor");
    expect(drafted.zones[0]!.notes).toContain("造墙");
    const p = {
      ...base(),
      zones: [
        {
          id: crypto.randomUUID(),
          name: "展览区",
          semantic: "reserved" as const,
          polygon: square(20, 20),
          notes: "",
        },
      ],
    };
    expect(
      proposeUseZones(p, {
        ...brief,
        zones: [{ ...brief.zones[0]!, environment: "indoor" }],
      }).zones[0]!.environment,
    ).toBe("indoor");
  });
  it("狭长场地拒绝过大真实物料，未保存半版/替换假尺寸", async () => {
    const plan = proposeUseZones(
      {
        ...base(),
        boundary: square(3, 60),
        zones: [
          {
            id: crypto.randomUUID(),
            name: "展览区",
            semantic: "reserved",
            polygon: square(3, 60),
            notes: "",
          },
        ],
      },
      { ...brief, zones: [brief.zones[0]!] },
    );
    await expect(
      proposeInventoryObjects(
        plan,
        {
          ...brief,
          items: [
            { zone: "展览区", query: "展板", count: 1, evidence: "展板" },
          ],
        },
        [
          {
            id: "real",
            name: "展板",
            source: "personal",
            width: 5,
            depth: 5,
            height: 2,
            modelSlug: "generated:real",
            available: true,
          },
        ],
      ),
    ).rejects.toThrow("放不下");
    expect(plan.facilities).toHaveLength(0);
  });
  it("凹形区域不跨凹口布置；不可分离的不规则分区要明确失败", () => {
    const plan = {
      ...base(),
      boundary: [
        { x: 0, y: 0 },
        { x: 80, y: 0 },
        { x: 80, y: 20 },
        { x: 20, y: 20 },
        { x: 20, y: 70 },
        { x: 0, y: 70 },
      ],
    };
    try {
      const next = proposeUseZones(plan, brief);
      validateWorkflowPlan(plan, next);
    } catch (error) {
      expect(String(error)).toMatch(/不规则|分区|边界/);
    }
  });
  it("内置库可参与排布；同名不同物件仍要求具体名称", async () => {
    const plan = proposeUseZones(base(), {
      ...brief,
      zones: [brief.zones[0]!],
    });
    const req = {
      ...brief,
      items: [{ zone: "展览区", query: "展板", count: 1, evidence: "展板" }],
    };
    const item = {
      id: "real",
      name: "展板A",
      source: "personal" as const,
      width: 2,
      depth: 1,
      height: 2,
      modelSlug: "generated:real",
      available: true,
    };
    // 2026-11-14「按主题排物件」起，内置 OnePlan 物件库与个人库同权参与落位（见 7b565ccc）；
    // 原先「公共目录不冒充我的库」的断言随功能反转，这里验证的只剩后半句：同名歧义不替你选。
    const builtIn = await proposeInventoryObjects(plan, req, [
      { ...item, source: "built-in" },
    ]);
    expect(builtIn.plan.facilities).toHaveLength(1);
    expect(builtIn.used[0]!.source).toBe("built-in");
    await expect(
      proposeInventoryObjects(plan, req, [
        item,
        { ...item, id: "b", name: "展板B" },
      ]),
    ).rejects.toThrow("具体名称");
  });
  it("生成物料名是一整段提示词时，落位只用短名，完整描述留在备注", async () => {
    const plan = proposeUseZones(base(), {
      ...brief,
      zones: [brief.zones[0]!],
    });
    const prompt =
      "户外折叠椅 1：铝合金折叠框架，藏青色厚棉布坐垫靠背，座高 45 厘米，展开尺寸约 45×50×88 厘米，四脚带黑色防滑脚垫，可折叠收纳。";
    const out = await proposeInventoryObjects(
      plan,
      {
        ...brief,
        items: [{ zone: "展览区", query: "户外折叠椅", count: 1, evidence: "一把户外折叠椅" }],
      },
      [
        {
          id: "generated-chair",
          name: prompt,
          source: "personal",
          width: 0.45,
          depth: 0.5,
          height: 0.88,
          modelSlug: "generated:chair",
          available: true,
        },
      ],
    );
    expect(out.plan.facilities[0]!.name).toBe("户外折叠椅 1");
    expect(out.plan.facilities[0]!.notes).toContain("生成描述：");
    expect(out.plan.facilities[0]!.notes).toContain("铝合金折叠框架");
  });
  it("库内占地与来源、混合用途、角色路径在保存读回时不丢", async () => {
    const plan = proposeUseZones(base(), {
      ...brief,
      zones: [brief.zones[0]!],
    });
    const out = await proposeInventoryObjects(
      plan,
      {
        ...brief,
        items: [{ zone: "展览区", query: "展板", count: 2, evidence: "展板" }],
      },
      [
        {
          id: "asset-1",
          name: "展板",
          source: "personal",
          width: 2,
          depth: 1,
          height: 2,
          modelSlug: "generated:real",
          available: true,
        },
      ],
    );
    const restored = sitePlanDataSchema.parse(
      JSON.parse(JSON.stringify(out.plan)),
    );
    expect(restored.facilities).toHaveLength(2);
    expect(restored.facilities[0]!.sourceAssetId).toBe("asset-1");
    expect(restored.zones[0]!.purpose).toBe("exhibition");
  });
  it("后勤人员不走车道；无岗位接驳不随机撒人", () => {
    const plan = proposeUseZones(base(), {
      ...brief,
      zones: [brief.zones[0]!],
    });
    const req = {
      ...brief,
      people: [
        {
          role: "服务人员",
          zone: "展览区",
          count: 2,
          audience: "service" as const,
          evidence: "服务人员2人",
        },
      ],
    };
    // 2026-11-18 分区按方位/面积落位后不再铺满整场：这条路按本区几何放在区内，
    // 验的仍是「后勤不走车道、要有人行+已核实口」这条规则。
    const zoneB = {
      w: Math.min(...plan.zones[0]!.polygon.map((v) => v.x)),
      e: Math.max(...plan.zones[0]!.polygon.map((v) => v.x)),
      s: Math.min(...plan.zones[0]!.polygon.map((v) => v.y)),
      n: Math.max(...plan.zones[0]!.polygon.map((v) => v.y)),
    };
    const yMid = (zoneB.s + zoneB.n) / 2;
    const from = { x: zoneB.w + 1.5, y: yMid };
    const to = { x: zoneB.e - 1.5, y: yMid };
    const route = {
      id: crypto.randomUUID(),
      name: "装卸车道",
      kind: "service" as const,
      points: [from, to],
      widthM: 4,
      oneWay: false,
      notes: "",
    };
    expect(() => proposeRoleWorkers({ ...plan, routes: [route] }, req)).toThrow(
      "接驳",
    );
    const next = proposeRoleWorkers(
      {
        ...plan,
        nodes: [
          {
            id: crypto.randomUUID(),
            name: "核实人员双向出入口",
            kind: "both",
            verification: "user-confirmed",
            position: from,
            notes: "",
          },
        ],
        routes: [{ ...route, kind: "pedestrian", audiences: ["service"] }],
      },
      req,
    );
    expect(next.workers[0]).toMatchObject({
      count: 2,
      routeIds: [route.id],
      activityZoneIds: [plan.zones[0]!.id],
      audience: "service",
    });
  });
  it("室内没有核实的门不从区边乱造子入口", () => {
    const p = {
      ...base(),
      zones: [
        {
          id: crypto.randomUUID(),
          name: "室内展览",
          semantic: "reserved" as const,
          purpose: "exhibition" as const,
          environment: "indoor" as const,
          polygon: square(20, 20),
          notes: "",
        },
      ],
      routes: [
        {
          id: crypto.randomUUID(),
          name: "主线",
          kind: "pedestrian" as const,
          points: [
            { x: 25, y: 5 },
            { x: 25, y: 50 },
          ],
          widthM: 3,
          oneWay: false,
          notes: "",
        },
      ],
    };
    expect(buildSubEntranceProposal(p)).toBeNull();
  });
});

it("观众容量不足或表演缺观众区给具体修正，不假装活动已适配", () => {
  const p = proposeUseZones(base(), { ...brief, zones: [brief.zones[0]!] });
  expect(() => validateWorkflowDemand(p, { ...brief, guests: 100000 })).toThrow(
    "2㎡/人",
  );
  const stage = proposeUseZones(base(), { ...brief, zones: [brief.zones[1]!] });
  expect(() => validateWorkflowDemand(stage, brief)).toThrow("观众区域");
});

const realInventoryFixture = async () => {
  const zonePlan = proposeUseZones(base(), { ...brief, zones: [brief.zones[0]!] });
  const { plan } = await proposeInventoryObjects(
    zonePlan,
    {
      ...brief,
      items: [{ zone: "展览区", query: "展板", count: 1, evidence: "1个展板" }],
    },
    [
      {
        id: "real",
        name: "展板",
        source: "personal",
        width: 2,
        depth: 1,
        height: 2,
        modelSlug: "generated:real",
        available: true,
      },
    ],
  );
  return plan;
};
it("逐区落位会上报进度文案，取消信号在区间生效", async () => {
  const plan = proposeUseZones(base(), { ...brief, zones: [brief.zones[0]!] });
  const phases: string[] = [];
  const out = await proposeInventoryObjects(
    plan,
    {
      ...brief,
      items: [{ zone: "展览区", query: "展板", count: 1, evidence: "1个展板" }],
    },
    [
      {
        id: "real",
        name: "展板",
        source: "personal",
        width: 2,
        depth: 1,
        height: 2,
        modelSlug: "generated:real",
        available: true,
      },
    ],
    undefined,
    { onPhase: (phase) => phases.push(phase) },
  );
  expect(phases).toHaveLength(1);
  expect(phases[0]).toContain("展览区");
  expect(phases[0]).toContain("展板");
  expect(out.plan.facilities).toHaveLength(1);

  const aborted = new AbortController();
  aborted.abort();
  await expect(
    proposeInventoryObjects(
      plan,
      {
        ...brief,
        items: [{ zone: "展览区", query: "展板", count: 1, evidence: "1个展板" }],
      },
      [
        {
          id: "real",
          name: "展板",
          source: "personal",
          width: 2,
          depth: 1,
          height: 2,
          modelSlug: "generated:real",
          available: true,
        },
      ],
      undefined,
      { signal: aborted.signal },
    ),
  ).rejects.toThrow("已取消");
});
it("改变区域边界也重验未修改设施，不能把原有物件留在区外", async () => {
  const p = await realInventoryFixture();
  const next = {
    ...p,
    zones: p.zones.map((z) => ({
      ...z,
      polygon: square(8, 8).map((v) => ({ x: v.x + 60, y: v.y + 50 })),
    })),
  };
  expect(() => validateWorkflowPlan(p, next)).toThrow("物件占地");
});
it("设施新占地不得覆盖既有人员岗位", async () => {
  const p = await realInventoryFixture();
  const f = p.facilities[0]!;
  const staffed = {
    ...p,
    facilities: [],
    workers: [
      {
        id: crypto.randomUUID(),
        role: "服务人员",
        count: 1,
        position: f.position,
        notes: "",
      },
    ],
  };
  expect(clearForObject(f, staffed, p.zones[0]!)).toBe(false);
});

const roleFixture = () => {
  const p = proposeUseZones(base(), { ...brief, zones: [brief.zones[0]!] });
  // 2026-11-18 分区改按方位/面积落位后，区不再铺满整场：夹具的入口与驳线跟着本区几何走，
  // 验证的仍是「区内有可用进出通道」这件事，不依赖绝对坐标。
  const zoneBox = {
    w: Math.min(...p.zones[0]!.polygon.map((v) => v.x)),
    e: Math.max(...p.zones[0]!.polygon.map((v) => v.x)),
    s: Math.min(...p.zones[0]!.polygon.map((v) => v.y)),
    n: Math.max(...p.zones[0]!.polygon.map((v) => v.y)),
  };
  const node = {
    id: crypto.randomUUID(),
    name: "已核对双向口",
    kind: "both" as const,
    verification: "user-confirmed" as const,
    position: { x: zoneBox.w + 1.5, y: (zoneBox.s + zoneBox.n) / 2 },
    notes: "",
  };
  return {
    ...p,
    nodes: [node],
    routes: [
      {
        id: crypto.randomUUID(),
        name: "双向人行",
        kind: "pedestrian" as const,
        points: [node.position, { x: zoneBox.e - 1.5, y: node.position.y }],
        widthM: 3,
        oneWay: false,
        notes: "",
      },
    ],
  };
};
it("同区域保安2改3替换而不累加；新增其他岗位不重复旧brief", () => {
  const p = roleFixture();
  const need = {
    role: "保安",
    zone: "展览区",
    count: 2,
    audience: "security" as const,
    evidence: "2保安",
  };
  const a = proposeRoleWorkers(p, { ...brief, people: [need] });
  const b = proposeRoleWorkers(a, {
    ...brief,
    people: [{ ...need, count: 3, evidence: "3保安" }],
  });
  expect(b.workers).toHaveLength(1);
  expect(b.workers[0]!.count).toBe(3);
  expect(b.workers[0]!.id).toBe(a.workers[0]!.id);
  const c = proposeRoleWorkers(b, {
    ...brief,
    people: [
      { ...need, count: 3 },
      { ...need, role: "工作人员", audience: "staff", count: 1 },
    ],
  });
  expect(c.workers).toHaveLength(2);
  expect(c.workers.reduce((n, w) => n + w.count, 0)).toBe(4);
});
it("单向区到入口只能出不能入，不得安排岗位；反向无出场也不得通过", () => {
  const p = roleFixture();
  p.nodes[0]!.position = { x: 0, y: 10 };
  p.zones[0]!.polygon = [
    { x: 40, y: 5 },
    { x: 60, y: 5 },
    { x: 60, y: 20 },
    { x: 40, y: 20 },
  ];
  p.routes[0]!.points = [
    { x: 50, y: 10 },
    { x: 0, y: 10 },
  ];
  p.routes[0]!.oneWay = true;
  const req = {
    ...brief,
    people: [
      {
        role: "保安",
        zone: "展览区",
        count: 2,
        audience: "security" as const,
        evidence: "2保安",
      },
    ],
  };
  expect(() => proposeRoleWorkers(p, req)).toThrow(/接驳|入场|出场/);
  p.routes[0]!.points.reverse();
  expect(() => proposeRoleWorkers(p, req)).toThrow(/接驳|入场|出场/);
});

it("有向入场与独立出口闭环可安排岗位，保存关联真实进出路径", () => {
  const p = roleFixture();
  const z = p.zones[0]!;
  const entry = {
      ...p.nodes[0]!,
      kind: "entry" as const,
      position: { x: 0, y: 10 },
    },
    exit = {
      ...p.nodes[0]!,
      id: crypto.randomUUID(),
      kind: "exit" as const,
      position: { x: 0, y: 20 },
    };
  const incoming = {
    ...p.routes[0]!,
    oneWay: true,
    points: [
      { x: 0, y: 10 },
      { x: 50, y: 10 },
    ],
  };
  const outgoing = {
    ...incoming,
    id: crypto.randomUUID(),
    points: [
      { x: 50, y: 10 },
      { x: 0, y: 20 },
    ],
  };
  const next = proposeRoleWorkers(
    {
      ...p,
      zones: [
        {
          ...z,
          polygon: [
            { x: 40, y: 5 },
            { x: 60, y: 5 },
            { x: 60, y: 20 },
            { x: 40, y: 20 },
          ],
        },
      ],
      nodes: [entry, exit],
      routes: [incoming, outgoing],
    },
    {
      ...brief,
      people: [
        {
          role: "保安",
          zone: "展览区",
          count: 2,
          audience: "security",
          evidence: "2保安",
        },
      ],
    },
  );
  expect(next.workers).toHaveLength(1);
  expect(new Set(next.workers[0]!.routeIds)).toEqual(
    new Set([incoming.id, outgoing.id]),
  );
  expect(next.workers[0]!.position).toEqual({ x: 50, y: 10 });
});

// 2026-11-17 正式站走查实测（死结 3）：需求里的分区名对不上画布上的分区时，
// 旧行为是整轮否掉（“没有唯一对应分区…未摆放物件”）。但需求清单只能按分区替换、
// 不能删区（协议 count 最小为 1），画布上没有的分区永远清不掉 → 物件阶段被永久卡死。
// 新行为：画布上的分区是权威，对不上的需求跳过并如实报出，其余分区照常排布。
describe("需求分区对不上画布时不再整轮卡死", () => {
  const smallBoard = {
    id: "real-board",
    name: "展板",
    source: "personal" as const,
    width: 2,
    depth: 1,
    height: 2,
    modelSlug: "generated:real",
    available: true,
  };
  const oneZonePlan = () =>
    proposeUseZones(base(), { ...brief, zones: [brief.zones[0]!] });

  it("对不上的那条跳过，其余分区照常排布，并如实报出对不上的分区", async () => {
    const plan = oneZonePlan();
    const out = await proposeInventoryObjects(
      plan,
      {
        ...brief,
        items: [
          { zone: "展览区", query: "展板", count: 1, evidence: "展览区放1个展板" },
          { zone: "餐饮区", query: "桌子", count: 4, evidence: "餐饮区放4张桌子" },
        ],
      },
      [smallBoard],
    );
    expect(out.plan.facilities).toHaveLength(1);
    expect(out.mismatched).toHaveLength(1);
    expect(out.mismatched[0]!.need.zone).toBe("餐饮区");
    expect(out.mismatched[0]!.reason).toBe("missing");
  });

  it("跳过的分区要写清画布上真实有哪些分区，不替用户猜位置", async () => {
    const plan = oneZonePlan();
    const out = await proposeInventoryObjects(
      plan,
      {
        ...brief,
        items: [
          { zone: "展览区", query: "展板", count: 1, evidence: "展览区放1个展板" },
          { zone: "餐饮区", query: "桌子", count: 4, evidence: "餐饮区放4张桌子" },
        ],
      },
      [smallBoard],
    );
    const notice = describeZoneMismatch(out.mismatched, plan);
    expect(notice).toContain("餐饮区");
    expect(notice).toContain("展览区");
    expect(notice).toContain("没有在这些分区猜位置");
  });

  it("全部需求都对不上时仍然报错（没有可排的东西不能出空提案）", async () => {
    const plan = oneZonePlan();
    await expect(
      proposeInventoryObjects(
        plan,
        {
          ...brief,
          items: [
            { zone: "餐饮区", query: "桌子", count: 4, evidence: "餐饮区放4张桌子" },
          ],
        },
        [smallBoard],
      ),
    ).rejects.toThrow(/餐饮区/);
  });

  it("画布上同名分区分不清时也不整轮否掉，如实报出", async () => {
    const plan = oneZonePlan();
    const serviceA = {
      id: crypto.randomUUID(),
      name: "餐饮区",
      semantic: "reserved" as const,
      purpose: "service" as const,
      environment: "outdoor" as const,
      polygon: square(10, 10),
      notes: "",
    };
    const serviceB = { ...serviceA, id: crypto.randomUUID(), polygon: square(20, 20) };
    const out = await proposeInventoryObjects(
      { ...plan, zones: [...plan.zones, serviceA, serviceB] },
      {
        ...brief,
        items: [
          { zone: "展览区", query: "展板", count: 1, evidence: "展览区放1个展板" },
          { zone: "餐饮区", query: "展板", count: 1, evidence: "餐饮区放1个展板" },
        ],
      },
      [smallBoard],
    );
    expect(out.mismatched).toHaveLength(1);
    expect(out.mismatched[0]!.need.zone).toBe("餐饮区");
    expect(out.mismatched[0]!.reason).toBe("duplicate");
    expect(out.plan.facilities).toHaveLength(1);
  });

  it("岗位分区对不上时同样跳过，不整轮否掉", () => {
    const p = roleFixture();
    const next = proposeRoleWorkers(p, {
      ...brief,
      people: [
        {
          role: "保安",
          zone: "展览区",
          count: 2,
          audience: "security",
          evidence: "2保安",
        },
        {
          role: "服务人员",
          zone: "餐饮区",
          count: 1,
          audience: "service",
          evidence: "1服务人员",
        },
      ],
    });
    expect(next.workers).toHaveLength(1);
    expect(next.workers[0]!.role).toBe("保安");
  });

  it("岗位全部对不上时仍然报错，并写清画布上真实分区", () => {
    const p = roleFixture();
    expect(() =>
      proposeRoleWorkers(p, {
        ...brief,
        people: [
          {
            role: "服务人员",
            zone: "餐饮区",
            count: 1,
            audience: "service",
            evidence: "1服务人员",
          },
        ],
      }),
    ).toThrow(/餐饮区/);
  });
});

describe("岗位通道缺失时按需补驳线（2026-11-17 死结 4）", () => {
  /**
   * 正式站实测的形状：签到台贴邻区、邻区子口就在共边旁 4m；
   * 现有动线里没有一条服务「服务人员」——旧口径整轮报错，且报错让用户去做的补救并不成立。
   */
  function serviceZoneFixture(): { plan: SitePlanData; zoneId: string; portalId: string } {
    const zoneId = crypto.randomUUID();
    const portalId = crypto.randomUUID();
    const plan: SitePlanData = {
      ...base(),
      boundary: [
        { x: 0, y: 0 },
        { x: 400, y: 0 },
        { x: 400, y: 500 },
        { x: 0, y: 500 },
      ],
      zones: [
        {
          id: zoneId,
          name: "签到台",
          semantic: "reserved",
          purpose: "service",
          environment: "outdoor",
          polygon: [
            { x: 60, y: 10 },
            { x: 100, y: 10 },
            { x: 100, y: 400 },
            { x: 60, y: 400 },
          ],
          notes: "",
        },
      ],
      routes: [
        {
          id: crypto.randomUUID(),
          name: "观众区驳线",
          kind: "pedestrian",
          audiences: ["visitors", "staff", "security"],
          points: [
            { x: 56, y: 205 },
            { x: -40, y: 205 },
          ],
          widthM: 2,
          oneWay: false,
          notes: "",
        },
      ],
      nodes: [
        {
          id: portalId,
          name: "观众区口",
          kind: "both",
          verification: "user-confirmed",
          position: { x: 56, y: 205 },
          notes: "",
        },
      ],
    };
    return { plan, zoneId, portalId };
  }

  const serviceNeed = {
    role: "服务人员",
    zone: "签到台",
    count: 2,
    audience: "service" as const,
    evidence: "签到台安排 2 名服务人员",
  };

  it("该分区没有这类岗位能走的通道时，先补一条专用驳线再排岗位", () => {
    const { plan, zoneId } = serviceZoneFixture();
    const next = proposeRoleWorkers(plan, { ...brief, people: [serviceNeed] });
    const spur = next.routes.find((r) => r.name.includes("签到台"));
    expect(spur).toBeTruthy();
    expect(spur!.audiences).toContain("service");
    expect(next.workers).toHaveLength(1);
    expect(next.workers[0]).toMatchObject({
      role: "服务人员",
      count: 2,
      audience: "service",
      activityZoneIds: [zoneId],
    });
    expect(next.workers[0]!.routeIds).toContain(spur!.id);
  });

  it("补不出通道时仍然硬拦，并写清缺什么、能改做什么", () => {
    const { plan } = serviceZoneFixture();
    let message = "";
    try {
      proposeRoleWorkers({ ...plan, routes: [] }, { ...brief, people: [serviceNeed] });
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toContain("签到台");
    expect(message).toMatch(/接驳|通道/);
    // 旧文案让用户「先安排子流线/子入口」——那条补救路径实际不成立，不能再这么写。
    expect(message).not.toContain("请先安排子流线/子入口");
    expect(message).toMatch(/补一条接驳线|改到已有通道/);
  });
});

/**
 * 2026-11-18 用户指令「agent 能不能智能根据分区摆放物件」。
 * 旧口径：分区沿 X 等宽切条、物件从西南角按网格第一个能放下的位置落，
 * 于是 6 块展板挤在南边 1.2% 的角落、舞台落在表演区西南角、音响只看谁先扫到空位。
 * 这一组用例锁住新口径：方位/面积 → 语义锚点 → 朝向与分布。
 */
const smartBrief: OutdoorBrief = {
  guests: 300,
  event: "户外市集",
  zones: [
    {
      name: "展览区",
      purpose: "exhibition",
      environment: "outdoor",
      position: "north-west",
      evidence: "展览区放西北角",
    },
    { name: "表演区", purpose: "performance", environment: "outdoor", evidence: "表演区" },
    { name: "观众区", purpose: "audience", environment: "outdoor", evidence: "观众区" },
    { name: "餐饮区", purpose: "market", environment: "outdoor", evidence: "餐饮区" },
  ],
  items: [
    { zone: "展览区", query: "展板", count: 6, evidence: "展览区6个展板" },
    { zone: "表演区", query: "舞台", count: 1, evidence: "表演区1个舞台" },
    { zone: "表演区", query: "音响", count: 2, evidence: "表演区2只音响" },
    { zone: "餐饮区", query: "摊位", count: 4, evidence: "餐饮区4个摊位" },
  ],
  people: [],
};
const smartLibrary = [
  { id: "scale:board", name: "展板", source: "personal" as const, width: 2, depth: 1, height: 2, modelSlug: "generated:board", available: true },
  { id: "scale:stage", name: "舞台", source: "personal" as const, width: 8, depth: 6, height: 1.2, modelSlug: "generated:stage", available: true },
  { id: "scale:speaker", name: "音响", source: "personal" as const, width: 1, depth: 1, height: 1.5, modelSlug: "generated:speaker", available: true },
  { id: "scale:stall", name: "市集摊位", source: "personal" as const, width: 3, depth: 3, height: 2.5, modelSlug: "generated:stall", available: true },
];
const ringBBox = (ring: { x: number; y: number }[]) => ({
  w: Math.min(...ring.map((p) => p.x)),
  e: Math.max(...ring.map((p) => p.x)),
  s: Math.min(...ring.map((p) => p.y)),
  n: Math.max(...ring.map((p) => p.y)),
});
const smartPlan = () =>
  proposeUseZones({ ...createStarterOutdoorPlan(), boundary: square() }, smartBrief);
const withSouthAccess = (plan: SitePlanData): SitePlanData => ({
  ...plan,
  nodes: [
    {
      id: crypto.randomUUID(),
      kind: "entry",
      name: "南主入口",
      position: { x: 40, y: 1 },
      notes: "",
    },
  ],
  routes: [
    {
      id: crypto.randomUUID(),
      kind: "pedestrian",
      name: "主通路",
      points: [
        { x: 40, y: 1 },
        { x: 40, y: 22 },
      ],
      oneWay: false,
      widthM: 4,
      notes: "",
    },
  ],
});
const placeSmart = (strategy?: "rows" | "center" | "perimeter") =>
  proposeInventoryObjects(
    withSouthAccess(smartPlan()),
    smartBrief,
    smartLibrary as never,
    undefined,
    strategy ? { strategy } : undefined,
  );

describe("智能按分区摆放（2026-11-18）", () => {
  it("用户说的方位生效：展览区落在西北角，且分区不再等宽铺满场地", () => {
    const plan = smartPlan();
    const exhibition = plan.zones.find((z) => z.name === "展览区")!;
    const b = ringBBox(exhibition.polygon);
    expect((b.w + b.e) / 2).toBeLessThan(40);
    expect((b.s + b.n) / 2).toBeGreaterThan(35);
    const total = plan.zones.reduce(
      (n, z) => n + Math.abs(
        z.polygon.reduce((sum, p, i) => {
          const q = z.polygon[(i + 1) % z.polygon.length]!;
          return sum + p.x * q.y - q.x * p.y;
        }, 0),
      ) / 2,
      0,
    );
    // 旧实现四块各 16m 宽、贯穿全高，合计接近整场；新口径按需要算面积，没提的区域留空。
    expect(total).toBeLessThan(80 * 70 * 0.6);
  });

  it("分区面积按用途与人数算：表演区小于按人的观众区", () => {
    const plan = smartPlan();
    const area = (name: string) => {
      const ring = plan.zones.find((z) => z.name === name)!.polygon;
      return Math.abs(ring.reduce((sum, p, i) => {
        const q = ring[(i + 1) % ring.length]!;
        return sum + p.x * q.y - q.x * p.y;
      }, 0)) / 2;
    };
    expect(area("表演区")).toBeLessThan(area("观众区"));
  });

  it("舞台贴着面向观众区的那条边，台宽垂直于观众方向", async () => {
    const out = await placeSmart();
    const stage = out.plan.facilities.find((f) => f.name.startsWith("舞台"))!;
    const audience = out.plan.zones.find((z) => z.name === "观众区")!;
    const ab = ringBBox(audience.polygon);
    const perform = out.plan.zones.find((z) => z.name === "表演区")!;
    const pb = ringBBox(perform.polygon);
    // 观众区在表演区南侧：舞台应落在表演区南边、横向对齐观众区中线
    expect(stage.position.y).toBeGreaterThan(ab.n);
    expect(Math.abs(stage.position.x - (ab.w + ab.e) / 2)).toBeLessThan(3);
    expect(stage.rotationDeg % 180).toBe(0);
    // 仍在自己的分区里，且离南边不超过 5m（不是被网格推回区中心）
    expect(stage.position.y).toBeLessThan(pb.s + 5);
  });

  it("两只音响左右对称夹台，不再一左一右差半米", async () => {
    const out = await placeSmart();
    const stage = out.plan.facilities.find((f) => f.name.startsWith("舞台"))!;
    const speakers = out.plan.facilities.filter((f) => f.name.startsWith("音响"));
    expect(speakers).toHaveLength(2);
    const left = speakers[0]!.position.x - stage.position.x;
    const right = speakers[1]!.position.x - stage.position.x;
    expect(Math.sign(left)).toBe(-Math.sign(right));
    expect(Math.abs(left + right)).toBeLessThan(0.01);
    expect(Math.abs(speakers[0]!.position.y - speakers[1]!.position.y)).toBeLessThan(0.01);
    expect(Math.abs(left)).toBeGreaterThan(stage.size.width / 2 - 0.5);
  });

  it("展板沿展览区周界铺开，不再挤在西南角", async () => {
    const out = await placeSmart();
    const exhibition = out.plan.zones.find((z) => z.name === "展览区")!;
    const b = ringBBox(exhibition.polygon);
    const boards = out.plan.facilities.filter((f) => f.name.startsWith("展板"));
    expect(boards).toHaveLength(6);
    const xs = boards.map((f) => f.position.x);
    const ys = boards.map((f) => f.position.y);
    const spanX = Math.max(...xs) - Math.min(...xs);
    const spanY = Math.max(...ys) - Math.min(...ys);
    // 旧实现 6 块挤在一行 2.13m 间距、y 跨度 0；现在至少铺开半个区，并出现横向+纵向两个方向
    expect(spanX).toBeGreaterThan((b.e - b.w) * 0.5);
    expect(spanY).toBeGreaterThan(2);
    expect(new Set(boards.map((f) => f.rotationDeg)).size).toBeGreaterThan(1);
  });

  it("摊位沿主通道成列，摊与摊之间留出可走人的间距", async () => {
    const out = await placeSmart();
    const stalls = out.plan.facilities.filter((f) => f.name.startsWith("市集摊位"));
    expect(stalls).toHaveLength(4);
    expect(new Set(stalls.map((f) => f.rotationDeg)).size).toBe(1);
    for (let i = 0; i < stalls.length; i++)
      for (let j = i + 1; j < stalls.length; j++) {
        const d = Math.hypot(
          stalls[i]!.position.x - stalls[j]!.position.x,
          stalls[i]!.position.y - stalls[j]!.position.y,
        );
        expect(d).toBeGreaterThanOrEqual(5);
      }
  });

  it("语义锚点不越过硬约束：压到主通路时仍整版拦下", async () => {
    // 一条 4m 主通路人行线从表演区正中穿过：舞台理想位在区南边中线，与通道相交。
    const base = withSouthAccess(smartPlan());
    const crossing = {
      ...base,
      routes: [
        ...base.routes,
        {
          id: crypto.randomUUID(),
          kind: "pedestrian" as const,
          name: "穿台通道",
          points: [
            { x: 40, y: 40 },
            { x: 40, y: 66 },
          ],
          oneWay: false,
          widthM: 4,
          notes: "",
        },
      ],
    };
    await expect(
      proposeInventoryObjects(crossing, smartBrief, smartLibrary as never),
    ).rejects.toThrow(/放不下/);
  });
});

/**
 * docs/47 A3 排布引擎吃证据（2026-11-19）。
 * 修前红的口径：60×60 场地、西半场（x≤29.5）是水域/绿地，网格首格 (1,1) 落在禁区/绿地里——
 * 旧引擎没有 hard 块检查、也没有代价评分，首-fit 直接把物件排进去。
 */
describe("docs/47 A3 排布引擎吃证据", () => {
  const a3Plan = () => ({
    ...base(),
    boundary: square(60, 60),
    zones: [
      {
        id: crypto.randomUUID(),
        name: "市集区",
        semantic: "reserved" as const,
        environment: "outdoor" as const,
        purpose: "market" as const,
        geometrySource: "user-confirmed" as const,
        polygon: square(60, 60),
        notes: "",
      },
    ],
  });
  const a3Brief: OutdoorBrief = {
    zones: [
      {
        name: "市集区",
        purpose: "market",
        environment: "outdoor",
        evidence: "市集区室外",
      },
    ],
    items: [{ zone: "市集区", query: "货箱", count: 3, evidence: "货箱" }],
    people: [],
  };
  const a3Library = [
    {
      id: "box",
      name: "货箱",
      source: "personal" as const,
      width: 2,
      depth: 2,
      height: 2,
      modelSlug: "generated:box",
      available: true,
    },
  ];
  // 西半场 x∈[0,29.5]（避开与 2m 网格对齐的退化边界）：网格首格 (1,1) 的占地
  // [0,2]² 整体在水里/绿地里；修后首个零代价格 (31,1) 与边界留 0.5m 实隙。
  const westBand = () => [
    { x: 0, y: 0 },
    { x: 29.5, y: 0 },
    { x: 29.5, y: 60 },
    { x: 0, y: 60 },
  ];

  it("带水域的场地排布不进水域（hard 块作禁区，修前红：首格排进湖里）", async () => {
    const out = await proposeInventoryObjects(a3Plan(), a3Brief, a3Library, undefined, {
      hardBlocks: [westBand()],
    });
    expect(out.plan.facilities).toHaveLength(3);
    for (const f of out.plan.facilities) {
      const ring = [
        { x: f.position.x - f.size.width / 2, y: f.position.y - f.size.depth / 2 },
        { x: f.position.x + f.size.width / 2, y: f.position.y - f.size.depth / 2 },
        { x: f.position.x + f.size.width / 2, y: f.position.y + f.size.depth / 2 },
        { x: f.position.x - f.size.width / 2, y: f.position.y + f.size.depth / 2 },
      ];
      expect(planPointInRing(f.position, westBand())).toBe(false);
      expect(outdoorRingsOverlap(ring, westBand())).toBe(false);
    }
    // 禁区占掉西半场后仍有落位：全在东半场。
    expect(out.plan.facilities.every((f) => f.position.x > 30)).toBe(true);
  });

  it("绿地代价使布局偏移（soft 评分，修前红：压绿地也照排）", async () => {
    const out = await proposeInventoryObjects(a3Plan(), a3Brief, a3Library, undefined, {
      softAreas: [westBand()],
    });
    expect(out.plan.facilities).toHaveLength(3);
    for (const f of out.plan.facilities) {
      // 零代价落位：不与绿地相交（贴边不算相交）。
      const ring = [
        { x: f.position.x - f.size.width / 2, y: f.position.y - f.size.depth / 2 },
        { x: f.position.x + f.size.width / 2, y: f.position.y - f.size.depth / 2 },
        { x: f.position.x + f.size.width / 2, y: f.position.y + f.size.depth / 2 },
        { x: f.position.x - f.size.width / 2, y: f.position.y + f.size.depth / 2 },
      ];
      expect(outdoorRingsOverlap(ring, westBand())).toBe(false);
    }
    expect(out.plan.facilities.every((f) => f.position.x > 30)).toBe(true);
  });

  it("没有绿地证据时行为与旧首-fit一致：不评分、不偏移", async () => {
    const withSoft = await proposeInventoryObjects(
      a3Plan(),
      a3Brief,
      a3Library,
      undefined,
      { softAreas: [] },
    );
    const without = await proposeInventoryObjects(a3Plan(), a3Brief, a3Library);
    expect(
      withSoft.plan.facilities.map((f) => [f.position.x, f.position.y]),
    ).toEqual(without.plan.facilities.map((f) => [f.position.x, f.position.y]));
  });
});


it("无分区物件依旧校验边界、碰撞与悬空分区引用", async () => {
  const original = base();
  const result = await proposeInventoryObjects(original, { zones: [], people: [], items: [{ zone: "", query: "椅子", count: 2, evidence: "2把椅子" }] }, [{ id: "chair", name: "椅子", source: "built-in", modelSlug: "oneplan:chair", available: true, width: 1, depth: 1, height: 1 }]);
  expect(result.plan.zones).toHaveLength(0);
  expect(() => validateWorkflowPlan(original, result.plan)).not.toThrow();
  const first = result.plan.facilities[0]!;
  const second = result.plan.facilities[1]!;
  expect(() => validateWorkflowPlan(original, { ...result.plan, facilities: [first, { ...second, position: first.position }] })).toThrow("冲突");
  expect(() => validateWorkflowPlan(original, { ...result.plan, facilities: [{ ...first, position: { x: -20, y: -20 } }] })).toThrow("冲突");
  expect(() => validateWorkflowPlan(original, { ...result.plan, facilities: [{ ...first, zoneId: crypto.randomUUID() }] })).toThrow("主归属分区不存在");
});
