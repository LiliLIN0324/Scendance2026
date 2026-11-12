import { useState } from "react";
import {
  OUTDOOR_STAGE_LABELS,
  type useOutdoorAgentWorkflow,
} from "../hooks/use-outdoor-agent-workflow";
import type { OutdoorTurn } from "../lib/outdoor-agent-contract";
export function OutdoorWorkflowCard({
  flow,
  onSearch,
  onSupplement,
}: {
  flow: ReturnType<typeof useOutdoorAgentWorkflow>;
  onSearch: (query: string) => void;
  onSupplement: () => void;
}) {
  const [query, setQuery] = useState("");
  const [libraryQuery, setLibraryQuery] = useState("");
  const [expanded, setExpanded] = useState(false);
  const actions: Partial<
    Record<typeof flow.state.stage, OutdoorTurn["action"]>
  > = {
    scope: "scope",
    zones: "zones",
    "main-routes": "main-routes",
    objects: "objects",
    "sub-routes": "sub-routes",
    people: "people",
    "refine-3d": "refine-3d",
  };
  return (
    <section
      className="ap-card ap-status-card"
      aria-label="活动规划渐进任务"
      data-testid="outdoor-workflow-card"
    >
      <header className="ap-card-head">
        <strong>
          {flow.busy ? "正在处理" : flow.proposal ? "待你核对" : "当前任务"} ·{" "}
          {OUTDOOR_STAGE_LABELS[flow.state.stage]}
        </strong>
        {(flow.busy || flow.simulating) && (
          <button type="button" onClick={flow.cancel}>
            {flow.simulating ? "停止流动示意" : "取消本次请求"}
          </button>
        )}
      </header>
      <p>
        {flow.notice ||
          "先搜索地点，再核对本次活动实际使用的范围；地图轮廓不代表商场整体可用。"}
      </p>
      {flow.state.brief.event && (
        <p>
          {flow.state.brief.event}
          {flow.state.brief.guests ? ` · 同时${flow.state.brief.guests}人` : ""}
        </p>
      )}
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded(!expanded)}
      >
        实际已确认步骤 · {flow.state.completed.length}
      </button>
      {expanded && (
        <ol>
          {flow.state.completed.slice(-4).map((s) => (
            <li key={s}>✓ {OUTDOOR_STAGE_LABELS[s]}</li>
          ))}
        </ol>
      )}
      {flow.proposal ? (
        <div>
          <strong>{flow.proposal.label}</strong>
          <ul>
            {flow.proposal.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
          <button
            className="btn-primary"
            type="button"
            disabled={flow.busy}
            onClick={() =>
              flow.proposal && void flow.confirmProposal(flow.proposal)
            }
          >
            确认并应用这一版
          </button>
          <button type="button" onClick={flow.cancel}>
            撤回预览
          </button>
          {flow.proposal.kind === "scope" && (
            <button
              type="button"
              onClick={() =>
                flow.proposal && flow.manualBoundary(flow.proposal)
              }
            >
              只用其中一部分，重新圈范围
            </button>
          )}
        </div>
      ) : flow.state.stage === "place" ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (query.trim()) onSearch(query.trim());
          }}
        >
          <label>
            地点名或地址
            <input
              aria-label="活动场地搜索"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="例如 杭州IN77"
            />
          </label>
          <button type="submit" disabled={flow.busy || !query.trim()}>
            搜索真实场地候选
          </button>
        </form>
      ) : (
        <button
          type="button"
          className="btn-primary"
          disabled={flow.busy}
          onClick={() => void flow.action(actions[flow.state.stage] ?? "ask")}
        >
          {flow.state.stage === "scope"
            ? "核对当前实际活动范围"
            : `预览${OUTDOOR_STAGE_LABELS[flow.state.stage]}`}
        </button>
      )}
      {!flow.proposal &&
        !flow.busy &&
        ["main-routes", "objects"].includes(flow.state.stage) &&
        flow.unverifiedEntrances.slice(0, 1).map((n) => (
          <div key={n.id}>
            <p>
              “{n.name}
              ”仍待核对：位置是规划意图/地图候选，不代表真实门和可通行权限。
            </p>
            <button
              type="button"
              onClick={() => void flow.action("verify-access", undefined, n.id)}
            >
              我已核对“{n.name}”可供本活动通行，预览标记
            </button>
          </div>
        ))}
      {(flow.state.stage === "objects" || flow.libraryChoices.length > 0) &&
        !flow.proposal && (
          <div aria-label="当前分区物料候选">
            <form
              onSubmit={(event) => {
                event.preventDefault();
                if (libraryQuery.trim())
                  void flow.action(
                    "library-search",
                    undefined,
                    undefined,
                    libraryQuery.trim(),
                  );
              }}
            >
              <label>
                从我的物料库查找
                <input
                  aria-label="物料名称或用途"
                  value={libraryQuery}
                  onChange={(e) => setLibraryQuery(e.target.value)}
                  placeholder="例如 展板、音响"
                />
              </label>
              <button
                type="submit"
                disabled={flow.busy || !libraryQuery.trim()}
              >
                检索真实库
              </button>
            </form>
            {flow.libraryChoices.map((item) => (
              <button
                type="button"
                key={item.id}
                disabled={flow.busy}
                aria-pressed={flow.selectedLibraryId === item.id}
                onClick={() => flow.chooseLibrary(item.id)}
              >
                {item.name} · {item.width.toFixed(2)}×{item.depth.toFixed(2)}m ·{" "}
                {item.modelSlug.startsWith("generated:local-glb:")
                  ? "本机会话"
                  : "我的库"}
              </button>
            ))}
            <label>
              缺物料？原位导入GLB（≤10MB，仅本会话，不上传不收费）
              <input
                type="file"
                aria-label="当前活动导入GLB物料"
                accept=".glb,model/gltf-binary"
                disabled={flow.busy}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (file) void flow.importLibraryGlb(file);
                }}
              />
            </label>
          </div>
        )}
      {flow.models && (
        <div aria-label="当前设施真实模型候选">
          {flow.models.choices.map((m, index) => (
            <button
              key={m.slug}
              type="button"
              disabled={flow.busy}
              onClick={() =>
                void flow.action("choose-model", index, flow.models!.facilityId)
              }
            >
              {m.name} · {m.source}
            </button>
          ))}
        </div>
      )}
      {flow.state.stage === "refine-3d" && !flow.proposal && (
        <div>
          <button type="button" onClick={() => void flow.action("models")}>
            比较所选设施模型
          </button>
          <button type="button" onClick={() => void flow.action("upload")}>
            给所选设施上传GLB
          </button>
          <button type="button" onClick={() => void flow.action("generate")}>
            准备原位生成（另行确认费用）
          </button>
        </div>
      )}
      {flow.state.stage === "refine-3d" && !flow.proposal && (
        <button
          type="button"
          onClick={() => void flow.action("generate-image")}
        >
          上传图片准备生成（另行确认费用）
        </button>
      )}
      {!flow.proposal && flow.state.stage === "zones" && (
        <button
          type="button"
          disabled={flow.busy}
          onClick={() => void flow.action("draw-zone")}
        >
          依据图纸/实测，在同地图画真实分区
        </button>
      )}
      {!flow.proposal && flow.state.stage === "main-routes" && (
        <div>
          <button
            type="button"
            disabled={flow.busy}
            onClick={() => void flow.action("draw-route")}
          >
            标出已知实际人行主线
          </button>
          <button
            type="button"
            disabled={flow.busy}
            onClick={() => void flow.action("draw-entrance")}
          >
            标出待核对入口
          </button>
        </div>
      )}
      <footer>
        <button type="button" onClick={onSupplement}>
          继续补充要求
        </button>
        {flow.proposal && (
          <button type="button" onClick={flow.cancel}>
            取消本次预览
          </button>
        )}
      </footer>
    </section>
  );
}
