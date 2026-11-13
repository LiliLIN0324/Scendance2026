import type {
  PlanPoint,
  PlanWorker,
  SitePlanData,
} from "../../../../supabase/functions/_shared/site-plan";
/** Directed planning graph, not a claim about surveyed access. Unknown levels are never joined to known other levels. */
export function personnelAccess(
  plan: SitePlanData,
  audience: NonNullable<PlanWorker["audience"]>,
) {
  const routes = plan.routes.filter(
    (r) =>
      r.kind === "pedestrian" &&
      (r.audiences
        ? r.audiences.includes(audience)
        : ["visitors", "staff", "security"].includes(audience)),
  );
  type Cut = { t: number; key: string };
  type Segment = {
    a: PlanPoint;
    b: PlanPoint;
    route: SitePlanData["routes"][number];
    cuts: Cut[];
  };
  const key = (p: PlanPoint, level?: string) =>
    JSON.stringify([
      level ?? plan.levels?.[0]?.id ?? "",
      Math.round(p.x * 1000),
      Math.round(p.y * 1000),
    ]);
  const segments: Segment[] = routes.flatMap((route) =>
    route.points.slice(1).map((b, i) => ({
      a: route.points[i]!,
      b,
      route,
      cuts: [
        { t: 0, key: key(route.points[i]!, route.levelId) },
        { t: 1, key: key(b, route.levelId) },
      ],
    })),
  );
  if (segments.length > 800)
    throw new Error("人员进出有向图过大，请分区核对接驳；未假定连通。");
  const at = (s: Segment, t: number) => ({
    x: s.a.x + (s.b.x - s.a.x) * t,
    y: s.a.y + (s.b.y - s.a.y) * t,
  });
  const cut = (s: Segment, t: number) => {
    const k = key(at(s, t), s.route.levelId);
    s.cuts.push({ t, key: k });
    return k;
  };
  const project = (s: Segment, p: PlanPoint) => {
    const dx = s.b.x - s.a.x,
      dy = s.b.y - s.a.y,
      l = dx * dx + dy * dy;
    const t = l
      ? Math.max(0, Math.min(1, ((p.x - s.a.x) * dx + (p.y - s.a.y) * dy) / l))
      : 0;
    const q = at(s, t);
    return { t, d: Math.hypot(q.x - p.x, q.y - p.y) };
  };
  type Edge = { to: string; routeId: string };
  const graph = new Map<string, Edge[]>(),
    reverse = new Map<string, Edge[]>();
  const edge = (a: string, b: string, routeId: string) => {
    graph.set(a, [...(graph.get(a) ?? []), { to: b, routeId }]);
    reverse.set(b, [...(reverse.get(b) ?? []), { to: a, routeId }]);
  };
  const level = (id?: string) => id ?? plan.levels?.[0]?.id;
  for (let i = 0; i < segments.length; i++)
    for (let j = i + 1; j < segments.length; j++) {
      const a = segments[i]!,
        b = segments[j]!;
      if (level(a.route.levelId) !== level(b.route.levelId)) continue;
      const dx = a.b.x - a.a.x,
        dy = a.b.y - a.a.y,
        ex = b.b.x - b.a.x,
        ey = b.b.y - b.a.y,
        den = dx * ey - dy * ex;
      if (Math.abs(den) > 1e-9) {
        const t = ((b.a.x - a.a.x) * ey - (b.a.y - a.a.y) * ex) / den,
          u = ((b.a.x - a.a.x) * dy - (b.a.y - a.a.y) * dx) / den;
        if (t >= 0 && t <= 1 && u >= 0 && u <= 1) {
          cut(a, t);
          cut(b, u);
        }
      }
      for (const [source, target] of [
        [a, b],
        [b, a],
      ] as const)
        for (const t of [0, 1]) {
          const p = at(source, t),
            q = project(target, p);
          if (q.d <= 0.5) {
            const from = cut(source, t),
              to = cut(target, q.t);
            edge(from, to, "");
            edge(to, from, "");
          }
        }
    }
  const entry = new Set<string>(),
    exit = new Set<string>();
  for (const n of plan.nodes.filter((n) => n.verification === "user-confirmed"))
    for (const s of segments) {
      if (level(n.levelId) !== level(s.route.levelId)) continue;
      const q = project(s, n.position);
      if (q.d > 1) continue;
      const k = cut(s, q.t);
      if (n.kind !== "exit") entry.add(k);
      if (n.kind !== "entry") exit.add(k);
    }
  for (const s of segments) {
    s.cuts.sort((a, b) => a.t - b.t);
    for (let i = 1; i < s.cuts.length; i++) {
      const a = s.cuts[i - 1]!.key,
        b = s.cuts[i]!.key;
      if (a === b) continue;
      edge(a, b, s.route.id);
      if (!s.route.oneWay) edge(b, a, s.route.id);
    }
  }
  const walk = (starts: Set<string>, g: Map<string, Edge[]>) => {
    const seen = new Map<string, { prev: string; routeId: string } | null>(
      [...starts].map((k) => [k, null]),
    );
    const queue = [...starts];
    for (let i = 0; i < queue.length; i++)
      for (const e of g.get(queue[i]!) ?? []) {
        if (seen.has(e.to)) continue;
        seen.set(e.to, { prev: queue[i]!, routeId: e.routeId });
        queue.push(e.to);
      }
    return seen;
  };
  const incoming = walk(entry, graph),
    outgoing = walk(exit, reverse);
  const paths = (p: PlanPoint, levelId?: string): string[] | null => {
    const k = key(p, levelId);
    if (!incoming.has(k) || !outgoing.has(k)) return null;
    const ids = new Set<string>();
    for (const parents of [incoming, outgoing]) {
      let current = k;
      for (let n = 0; n <= parents.size; n++) {
        const link = parents.get(current);
        if (!link) break;
        if (link.routeId) ids.add(link.routeId);
        current = link.prev;
      }
    }
    return [...ids];
  };
  return {
    paths,
    routes: routes.filter((r) =>
      r.points.some((p) => paths(p, r.levelId) !== null),
    ),
  };
}
