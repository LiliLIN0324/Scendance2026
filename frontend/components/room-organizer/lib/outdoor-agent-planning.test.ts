import { describe, it, expect } from "vitest";
import { createStarterOutdoorPlan } from "./outdoor-project-store";
import {
  proposeUseZones,
  proposeInventoryObjects,
  proposeRoleWorkers,
  validateWorkflowPlan,
  validateWorkflowDemand,
  clearForObject,
} from "./outdoor-agent-planning";
import { sitePlanDataSchema } from "../../../../supabase/functions/_shared/site-plan";
import { buildSubEntranceProposal } from "./sub-entrance";
import type { OutdoorBrief } from "./outdoor-agent-contract";
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
  it("室内未知边界不猜；已有用户画区才能赋室内展览用途", () => {
    expect(() =>
      proposeUseZones(base(), {
        ...brief,
        zones: [{ ...brief.zones[0]!, environment: "indoor" }],
      }),
    ).toThrow("图纸");
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
  it("狭长场地拒绝过大真实物料，未保存半版/替换假尺寸", () => {
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
    expect(() =>
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
    ).toThrow("放不下");
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
  it("公共目录不冒充我的库，歧义候选不随便用第一个", () => {
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
    expect(() =>
      proposeInventoryObjects(plan, req, [{ ...item, source: "built-in" }]),
    ).toThrow("真实物料库");
    expect(() =>
      proposeInventoryObjects(plan, req, [
        item,
        { ...item, id: "b", name: "展板B" },
      ]),
    ).toThrow("具体名称");
  });
  it("库内占地与来源、混合用途、角色路径在保存读回时不丢", () => {
    const plan = proposeUseZones(base(), {
      ...brief,
      zones: [brief.zones[0]!],
    });
    const out = proposeInventoryObjects(
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
    const route = {
      id: crypto.randomUUID(),
      name: "装卸车道",
      kind: "service" as const,
      points: [
        { x: 10, y: 10 },
        { x: 30, y: 10 },
      ],
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
            position: { x: 10, y: 10 },
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

const realInventoryFixture = () => {
  const p = proposeUseZones(base(), { ...brief, zones: [brief.zones[0]!] });
  return proposeInventoryObjects(
    p,
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
  ).plan;
};
it("改变区域边界也重验未修改设施，不能把原有物件留在区外", () => {
  const p = realInventoryFixture();
  const next = {
    ...p,
    zones: p.zones.map((z) => ({
      ...z,
      polygon: square(8, 8).map((v) => ({ x: v.x + 60, y: v.y + 50 })),
    })),
  };
  expect(() => validateWorkflowPlan(p, next)).toThrow("物件占地");
});
it("设施新占地不得覆盖既有人员岗位", () => {
  const p = realInventoryFixture();
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
  const node = {
    id: crypto.randomUUID(),
    name: "已核对双向口",
    kind: "both" as const,
    verification: "user-confirmed" as const,
    position: { x: 10, y: 10 },
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
        points: [
          { x: 10, y: 10 },
          { x: 30, y: 10 },
        ],
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
