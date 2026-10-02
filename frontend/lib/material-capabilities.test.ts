import { describe, expect, it } from "vitest";
import { catalog, materialIds, objectSchema } from "../../supabase/functions/_shared/domain";
import { inspectMaterialRequirements } from "./material-capabilities";

describe("conservative material capability inspection", () => {
  it("gets all eight supported IDs and dimensions from the real backend catalog", () => {
    const result = inspectMaterialRequirements(catalog.map(item => item.name).join("、"));
    expect(result.supported.map(item => item.materialId)).toEqual([...materialIds]);
    for (const finding of result.supported) {
      const actual = catalog.find(item => item.id === finding.materialId)!;
      expect(finding.catalogSize).toEqual(actual.size);
      expect(objectSchema.safeParse({ id: "10000000-0000-4000-8000-000000000001", materialId: finding.materialId,
        position: { x: 1, z: 1 }, rotation: 0, size: finding.catalogSize, color: "#ffffff", locked: false }).success).toBe(true);
    }
    expect(result.missing).toEqual([]);
    expect(result.needsConfirmation).toEqual([]);
    expect(result.unrecognized).toEqual([]);
  });

  it.each(["帐篷", "拱门", "串灯", "圆桌", "天幕", "灯带", "舞台", "沙发"])("reports %s as missing without fabricating a supported material ID", name => {
    const result = inspectMaterialRequirements(`需要${name}`);
    expect(result.missing).toHaveLength(1);
    expect(result.missing[0]).toMatchObject({ availability: "unavailable", status: "missing" });
    expect(result.missing[0]).not.toHaveProperty("materialId");
    expect(result.supported).toEqual([]);
    expect(result.requiresConfirmation).toBe(true);
  });

  it.each(["圆形的桌子", "圆桌子", "直径2米的桌子", "桌子要圆形的", "round table"])("does not resolve %s to the generic table", text => {
    const result = inspectMaterialRequirements(`需要${text}`);
    expect(result.missing[0]?.key).toBe("round-table");
    expect(result.supported).toEqual([]);
    expect(result.missing[0]?.suggestions).toEqual([expect.objectContaining({ materialId: "table", requiresUserConsent: true })]);
  });

  it.each(["不要帐篷", "无需帐篷", "不需要帐篷", "不想要帐篷", "不搭建帐篷", "不要使用帐篷", "帐篷不要", "帐篷不需要"])("excludes the explicit negation %s", text => {
    const result = inspectMaterialRequirements(text);
    expect(result.excluded.map(item => item.key)).toEqual(["tent"]);
    expect(result.missing).toEqual([]);
    expect(result.needsConfirmation).toEqual([]);
    expect(result.requiresConfirmation).toBe(false);
  });

  it("keeps obvious list negation scoped separately from a following positive instruction", () => {
    const result = inspectMaterialRequirements("不要帐篷和拱门，但需要串灯和椅子");
    expect(result.excluded.map(item => item.key)).toEqual(["tent", "arch"]);
    expect(result.missing.map(item => item.key)).toEqual(["string-lights"]);
    expect(result.supported.map(item => item.materialId)).toEqual(["chair"]);
  });

  it("recognizes a trailing shared negation", () => {
    const result = inspectMaterialRequirements("帐篷、拱门都不要，改为背景板");
    expect(result.excluded.map(item => item.key)).toEqual(["tent", "arch"]);
    expect(result.missing).toEqual([]);
    expect(result.supported.map(item => item.materialId)).toEqual(["backdrop"]);
  });

  it.each(["考虑帐篷", "帐篷或者拱门", "要不要帐篷", "不是不要帐篷", "不一定需要帐篷", "需要帐篷造型的背景板", "不要移动帐篷", "不要去掉帐篷"])("asks for confirmation for uncertainty or a complex phrase: %s", text => {
    const result = inspectMaterialRequirements(text);
    expect(result.needsConfirmation.some(item => item.key === "tent")).toBe(true);
    expect(result.missing).toEqual([]);
    expect(result.excluded).toEqual([]);
  });

  it("does not infer a physical circular table from the event name 圆桌讨论", () => {
    const result = inspectMaterialRequirements("安排圆桌讨论");
    expect(result.needsConfirmation.map(item => item.key)).toEqual(["round-table"]);
    expect(result.missing).toEqual([]);
  });

  it("keeps contradictory requirements visible instead of choosing one silently", () => {
    const result = inspectMaterialRequirements("不要帐篷，但需要帐篷");
    expect(result.needsConfirmation[0]).toMatchObject({ key: "tent", evidence: ["不要帐篷", "需要帐篷"] });
    expect(result.needsConfirmation[0]?.message).toContain("同时出现");
    expect(result.missing).toEqual([]);
    expect(result.excluded).toEqual([]);
  });

  it("keeps dimension and material requirements pending even for known categories", () => {
    const result = inspectMaterialRequirements("需要2米长的桌子和木质椅子");
    expect(result.needsConfirmation.map(item => item.materialId)).toEqual(["table", "chair"]);
    expect(result.needsConfirmation.every(item => item.availability === "available")).toBe(true);
    expect(result.supported).toEqual([]);
  });

  it("preserves unknown requirements alongside recognized materials", () => {
    const result = inspectMaterialRequirements("需要椅子和星云互动装置");
    expect(result.supported.map(item => item.materialId)).toEqual(["chair"]);
    expect(result.unrecognized).toContain("星云互动装置");
    expect(result.requiresConfirmation).toBe(true);
    const unknown = inspectMaterialRequirements("需要全息鹿和量子花园");
    expect(unknown.supported).toEqual([]);
    expect(unknown.unrecognized.join(" ")).toContain("全息鹿");
    expect(unknown.unrecognized.join(" ")).toContain("量子花园");
  });

  it("does not match an English ID inside an unrelated word", () => {
    const result = inspectMaterialRequirements("stable sustainable chairmanship");
    expect(result.supported).toEqual([]);
    expect(result.unrecognized).toHaveLength(1);
  });

  it("recognizes the common compound 桌椅 as two actual categories", () => {
    const result = inspectMaterialRequirements("需要桌椅");
    expect(result.supported.map(item => item.materialId)).toEqual(["chair", "table"]);
    expect(result.unrecognized).toEqual([]);
  });

  it("can exclude the circular variant while recognizing an explicitly requested generic table", () => {
    const result = inspectMaterialRequirements("不要圆桌，只要普通桌子");
    expect(result.excluded.map(item => item.key)).toEqual(["round-table"]);
    expect(result.supported.map(item => item.materialId)).toEqual(["table"]);
    expect(result.unrecognized).toEqual([]);
    expect(result.requiresConfirmation).toBe(false);
  });

  it("does not offer automatic substitutions for excluded or unavailable objects", () => {
    expect(inspectMaterialRequirements("不要圆桌").excluded[0]?.suggestions).toEqual([]);
    const findings = inspectMaterialRequirements("帐篷、拱门、圆桌").missing;
    expect(findings.every(item => item.suggestions.every(suggestion => suggestion.requiresUserConsent))).toBe(true);
    expect(findings.filter(item => item.key !== "round-table").every(item => item.suggestions.length === 0)).toBe(true);
  });

  it("is deterministic and cannot mutate the authoritative catalog through returned sizes", () => {
    const original = JSON.stringify(catalog);
    const first = inspectMaterialRequirements("椅子、圆桌、不要帐篷");
    expect(inspectMaterialRequirements("椅子、圆桌、不要帐篷")).toEqual(first);
    first.supported[0]!.catalogSize!.width = 99;
    expect(JSON.stringify(catalog)).toBe(original);
    expect(inspectMaterialRequirements("椅子").supported[0]?.catalogSize?.width).toBe(0.5);
  });

  it("handles empty input without inventing requirements or claiming complete understanding", () => {
    const result = inspectMaterialRequirements("  \n ");
    expect(result.supported).toEqual([]);
    expect(result.missing).toEqual([]);
    expect(result.unrecognized).toEqual([]);
    expect(result.notice).toContain("不是完整语义理解");
    expect(result.requiresConfirmation).toBe(false);
  });
});
