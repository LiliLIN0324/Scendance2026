import { useEffect, useState } from "react";
import { Map as MapIcon, TriangleAlert } from "@/components/solid-icons";
import {
  OUTDOOR_STAGE_LABELS,
  type useOutdoorAgentWorkflow,
} from "../hooks/use-outdoor-agent-workflow";
import type { OutdoorStage, OutdoorTurn } from "../lib/outdoor-agent-contract";

/** 每阶段一句图注；进行中的真实进度文案会临时顶替它，报错走红卡。 */
const STAGE_CAPTIONS: Record<OutdoorStage, string> = {
  place: "请核对活动实际范围，自动为你框选项目区域",
  scope: "已框出项目区域，确认后写进方案；也可只取其中一部分",
  zones: "按活动用途划分功能分区，室内外依据随区标注",
  "main-routes": "沿真实路网排人流（绿）/车流（灰）/后勤（点线）与出入口",
  objects: "按分区复用我的物料自动排布，也可先检索物料库",
  "sub-routes": "补齐物件间隙的子出入口与支线，散场不再挤主门",
  people: "岗位、人数与活动路径；可开流动示意看散场节奏",
  "refine-3d": "选中设施换模型、原位上传或生成（费用单独确认）",
};

/** 2026-11-15 对标谷地工坊的建议体系：每阶段给可点的「下一句」，点即填进输入框，
 *  不用自己想措辞。只做预填不做提交——发送仍是用户按键确认的动作。 */
const STAGE_PROMPTS: Record<OutdoorStage, readonly string[]> = {
  place: ["在杭州西湖边办一场周末市集", "先找杭州 IN77，核对可用的活动范围"],
  scope: ["就用这个范围", "范围往北扩一点"],
  zones: ["按活动用途分区", "签到区和观众区放北侧"],
  "main-routes": ["排一下流线和出入口", "入口放在正门，别走地下车库"],
  objects: ["签到区摆 2 张桌子", "舞台区配音响和背景板"],
  "sub-routes": ["补一下子出入口", "散场支线也排一下"],
  people: ["展览区 2 名保安、表演区 3 名工作人员"],
  "refine-3d": ["给舞台换个模型", "开流动模拟看散场"],
};

/** 底图共享层：地表/水系/道路/街区，各阶段变体只追加自己的覆盖层。 */
function ThumbBase(): JSX.Element {
  return (
    <>
      <rect width="320" height="150" fill="#DDE8D2" />
      <path
        d="M0 118 C 60 108, 120 126, 180 120 S 290 132, 320 124 L320 150 L0 150 Z"
        fill="#BFD9E8"
      />
      <path
        d="M36 22 C 90 40, 120 78, 196 88 S 268 96, 300 92"
        stroke="#F4ECD9"
        strokeWidth="10"
        fill="none"
        strokeLinecap="round"
      />
      <path
        d="M140 24 C 150 52, 168 70, 210 88"
        stroke="#F4ECD9"
        strokeWidth="6"
        fill="none"
        strokeLinecap="round"
      />
      <rect x="60" y="40" width="44" height="30" rx="4" fill="#C9DCC0" />
      <rect x="212" y="34" width="52" height="26" rx="4" fill="#C9DCC0" />
      <rect x="236" y="100" width="40" height="20" rx="4" fill="#C9DCC0" />
      <rect x="118" y="96" width="34" height="22" rx="4" fill="#D8CDB4" />
    </>
  );
}

/**
 * 卡片上幅的风格化地图缩略（自绘 SVG，无网络依赖、不声称是真实轮廓）：
 * 同一底图按阶段换覆盖层——place 落点、scope 选区、zones 色块、routes 箭头、
 * objects 座椅、sub-routes 支线、people 人流、refine-3d 体块。
 * 真实几何出来后逐步替换为数据切片，示意只是开局的占位观感。
 */
function StageThumb({ stage }: { stage: OutdoorStage }): JSX.Element {
  return (
    <svg
      className="ap-task-map"
      viewBox="0 0 320 150"
      role="img"
      aria-label="地图缩略示意"
      aria-hidden="true"
    >
      <ThumbBase />
      {stage === "place" && (
        <>
          <rect x="118" y="52" width="110" height="62" rx="8" fill="none" stroke="#4A7C59" strokeWidth="2.5" strokeDasharray="7 6" />
          <circle cx="173" cy="83" r="5" fill="#4A7C59" />
        </>
      )}
      {stage === "scope" && (
        <>
          <rect x="86" y="38" width="150" height="72" rx="6" fill="color-mix(in srgb, #4A7C59 14%, #ffffff)" stroke="#4A7C59" strokeWidth="2.5" />
          <rect x="82" y="34" width="8" height="8" fill="#ffffff" stroke="#4A7C59" strokeWidth="2" />
          <rect x="232" y="34" width="8" height="8" fill="#ffffff" stroke="#4A7C59" strokeWidth="2" />
          <rect x="82" y="106" width="8" height="8" fill="#ffffff" stroke="#4A7C59" strokeWidth="2" />
          <rect x="232" y="106" width="8" height="8" fill="#ffffff" stroke="#4A7C59" strokeWidth="2" />
        </>
      )}
      {stage === "zones" && (
        <>
          <rect x="40" y="24" width="112" height="70" rx="6" fill="#C9DCC0" stroke="#ffffff" strokeWidth="2" />
          <rect x="158" y="24" width="122" height="42" rx="6" fill="#F2E3C2" stroke="#ffffff" strokeWidth="2" />
          <rect x="158" y="72" width="122" height="40" rx="6" fill="#BFD9E8" stroke="#ffffff" strokeWidth="2" />
          <rect x="40" y="100" width="240" height="14" rx="4" fill="#E3D9C0" stroke="#ffffff" strokeWidth="2" />
          <text x="62" y="62" fontSize="11" fill="#35624A">观众区</text>
          <text x="176" y="48" fontSize="11" fill="#96651F">表演区</text>
          <text x="176" y="95" fontSize="11" fill="#3D6C8C">餐饮区</text>
          <text x="60" y="111" fontSize="10" fill="#7A6F52">后勤带</text>
        </>
      )}
      {stage === "main-routes" && (
        <>
          <rect x="118" y="46" width="96" height="52" rx="6" fill="#C9DCC0" stroke="#ffffff" strokeWidth="2" />
          <rect x="228" y="30" width="52" height="30" rx="6" fill="#C9DCC0" stroke="#ffffff" strokeWidth="2" />
          <path d="M18 128 C 60 112, 92 96, 132 78" stroke="#4A7C59" strokeWidth="4" fill="none" strokeLinecap="round" />
          <path d="M132 78 L 122 80 M132 78 L 128 88" stroke="#4A7C59" strokeWidth="4" fill="none" strokeLinecap="round" />
          <path d="M300 40 C 270 56, 246 62, 218 66" stroke="#55585F" strokeWidth="5" strokeDasharray="10 7" fill="none" strokeLinecap="round" />
          <path d="M218 66 L 228 58 M218 66 L 229 70" stroke="#55585F" strokeWidth="5" fill="none" strokeLinecap="round" />
          <path d="M300 118 C 262 112, 232 108, 206 102" stroke="#96651F" strokeWidth="3.5" strokeDasharray="3 6" fill="none" strokeLinecap="round" />
          <circle cx="132" cy="78" r="5" fill="#ffffff" stroke="#35624A" strokeWidth="2.5" />
          <circle cx="300" cy="40" r="5" fill="#ffffff" stroke="#55585F" strokeWidth="2.5" />
          <circle cx="300" cy="118" r="5" fill="#ffffff" stroke="#96651F" strokeWidth="2.5" />
        </>
      )}
      {stage === "objects" && (
        <>
          <rect x="40" y="24" width="112" height="70" rx="6" fill="#C9DCC0" stroke="#ffffff" strokeWidth="2" />
          <rect x="158" y="24" width="122" height="42" rx="6" fill="#F2E3C2" stroke="#ffffff" strokeWidth="2" />
          <g fill="#ffffff" stroke="#4A7C59" strokeWidth="1.5">
            <rect x="54" y="36" width="9" height="9" rx="2" /><rect x="70" y="36" width="9" height="9" rx="2" /><rect x="86" y="36" width="9" height="9" rx="2" /><rect x="102" y="36" width="9" height="9" rx="2" /><rect x="118" y="36" width="9" height="9" rx="2" />
            <rect x="54" y="56" width="9" height="9" rx="2" /><rect x="70" y="56" width="9" height="9" rx="2" /><rect x="86" y="56" width="9" height="9" rx="2" /><rect x="102" y="56" width="9" height="9" rx="2" /><rect x="118" y="56" width="9" height="9" rx="2" />
          </g>
          <g fill="#ffffff" stroke="#96651F" strokeWidth="1.5">
            <circle cx="182" cy="40" r="6" /><circle cx="206" cy="40" r="6" /><circle cx="230" cy="40" r="6" /><circle cx="254" cy="40" r="6" />
          </g>
          <rect x="176" y="56" width="64" height="6" rx="3" fill="#96651F" opacity="0.55" />
        </>
      )}
      {stage === "sub-routes" && (
        <>
          <rect x="118" y="46" width="96" height="52" rx="6" fill="#C9DCC0" stroke="#ffffff" strokeWidth="2" />
          <rect x="40" y="30" width="52" height="34" rx="6" fill="#C9DCC0" stroke="#ffffff" strokeWidth="2" />
          <path d="M18 128 C 60 112, 92 96, 132 78" stroke="#4A7C59" strokeWidth="4" fill="none" strokeLinecap="round" opacity="0.6" />
          <path d="M132 78 C 110 66, 92 60, 76 58" stroke="#35624A" strokeWidth="3" fill="none" strokeLinecap="round" />
          <path d="M132 78 C 118 96, 108 106, 96 112" stroke="#35624A" strokeWidth="3" fill="none" strokeLinecap="round" />
          <path d="M132 78 C 156 66, 176 62, 196 62" stroke="#35624A" strokeWidth="3" fill="none" strokeLinecap="round" />
          <rect x="72" y="52" width="9" height="9" rx="2" fill="#ffffff" stroke="#35624A" strokeWidth="2" />
          <rect x="91" y="107" width="9" height="9" rx="2" fill="#ffffff" stroke="#35624A" strokeWidth="2" />
          <rect x="192" y="57" width="9" height="9" rx="2" fill="#ffffff" stroke="#35624A" strokeWidth="2" />
        </>
      )}
      {stage === "people" && (
        <>
          <rect x="118" y="46" width="96" height="52" rx="6" fill="#C9DCC0" stroke="#ffffff" strokeWidth="2" />
          <path d="M30 120 C 70 100, 110 84, 150 74 S 220 62, 250 58" stroke="#7FA8C9" strokeWidth="2.5" fill="none" strokeLinecap="round" opacity="0.7" />
          <g fill="#4A7C59">
            <circle cx="60" cy="106" r="2.6" /><circle cx="72" cy="101" r="2.6" /><circle cx="86" cy="94" r="2.6" /><circle cx="98" cy="90" r="2.6" /><circle cx="112" cy="84" r="2.6" /><circle cx="126" cy="79" r="2.6" />
            <circle cx="142" cy="75" r="2.6" /><circle cx="156" cy="71" r="2.6" /><circle cx="170" cy="68" r="2.6" /><circle cx="184" cy="66" r="2.6" /><circle cx="198" cy="64" r="2.6" /><circle cx="212" cy="62" r="2.6" />
          </g>
          <g fill="#96651F">
            <rect x="120" y="42" width="10" height="10" rx="2" transform="rotate(45 125 47)" />
            <rect x="206" y="90" width="10" height="10" rx="2" transform="rotate(45 211 95)" />
          </g>
          <text x="134" y="51" fontSize="10" fill="#7A5A17">保安</text>
          <text x="220" y="100" fontSize="10" fill="#7A5A17">医疗</text>
        </>
      )}
      {stage === "refine-3d" && (
        <>
          <rect x="48" y="36" width="52" height="30" rx="4" fill="#C9DCC0" />
          <rect x="230" y="92" width="44" height="22" rx="4" fill="#C9DCC0" />
          <path d="M150 52 L 186 40 L 222 52 L 186 64 Z" fill="#9DBB92" />
          <path d="M150 52 L 186 64 L 186 100 L 150 88 Z" fill="#6F9770" />
          <path d="M186 64 L 222 52 L 222 88 L 186 100 Z" fill="#4A7C59" />
          <text x="168" y="84" fontSize="10" fill="#ffffff">主舞台</text>
        </>
      )}
    </svg>
  );
}

export function OutdoorWorkflowCard({
  flow,
  onPrefill,
  onCancelPreview,
}: {
  flow: ReturnType<typeof useOutdoorAgentWorkflow>;
  /** 「下一句」建议芯片的预填回调：点芯片只填输入框，发送仍是用户按键确认。 */
  onPrefill?: ((text: string) => void) | undefined;
  /** 2026-11-15 用户拍板：撤回预览要在对话流留「已放弃」徽章——按钮经此回调，
   *  由面板调 cancel() 并补一条决策留痕气泡；不传则保持原直调 cancel() 的行为。 */
  onCancelPreview?: (() => void) | undefined;
}) {
  const [libraryQuery, setLibraryQuery] = useState("");
  // 低风险提示条倒计时收场（对标谷地工坊「8 秒后自动按下」）：非错误提示、空闲且无待确认
  // 提案时才启动倒计时；「预览已就绪，核对后确认」这类要等动作的提示不自动消失。
  const [noticeCountdown, setNoticeCountdown] = useState<number | null>(null);
  useEffect(() => {
    if (!flow.notice || flow.noticeKind === "error" || flow.busy || flow.proposal) {
      setNoticeCountdown(null);
      return;
    }
    setNoticeCountdown(8);
    const timer = window.setInterval(() => {
      setNoticeCountdown((value) => (value === null ? null : value - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [flow.notice, flow.noticeKind, flow.busy, flow.proposal]);
  useEffect(() => {
    if (noticeCountdown !== null && noticeCountdown <= 0) {
      setNoticeCountdown(null);
      flow.dismissNotice();
    }
  }, [noticeCountdown, flow.dismissNotice]);
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
    <>
    {/* 2026-11-14 用户指令：「前往登录」独立成一张卡，不再混在任务卡底部。 */}
    <section
      className="ap-card ap-status-card"
      aria-label="活动规划渐进任务"
      data-testid="outdoor-workflow-card"
      aria-busy={flow.busy || undefined}
    >
      <header className="ap-card-head">
        <strong>
          {flow.busy ? "正在处理" : flow.proposal ? "待你核对" : "当前任务"} ·{" "}
          {OUTDOOR_STAGE_LABELS[flow.state.stage]}
        </strong>
      </header>
      {flow.busy && (
        <div className="ap-task-progress" aria-hidden="true" />
      )}
      <StageThumb stage={flow.state.stage} />
      {flow.notice && flow.noticeKind === "error" ? (
        <div className="ap-task-error" role="alert">
          <TriangleAlert size={14} aria-hidden="true" />
          <p>{flow.notice}</p>
          {/* 2026-11-14 用户指令：错误卡直接给「重试」，按当前阶段动作原样再跑一遍。 */}
          <button
            type="button"
            className="ap-task-retry"
            disabled={flow.busy}
            onClick={() => void flow.action(actions[flow.state.stage] ?? "ask")}
          >
            重试
          </button>
        </div>
      ) : (
        <p className="ap-task-caption">
          <MapIcon size={13} aria-hidden="true" />
          {flow.notice || STAGE_CAPTIONS[flow.state.stage]}
          {noticeCountdown !== null && noticeCountdown > 0 && (
            <span className="ap-task-countdown" aria-hidden="true"> · {noticeCountdown}s 后收起</span>
          )}
        </p>
      )}
      {flow.state.brief.event && (
        <p>
          {flow.state.brief.event}
          {flow.state.brief.guests ? ` · 同时${flow.state.brief.guests}人` : ""}
        </p>
      )}
      {flow.proposal ? (
        <div>
          <strong>{flow.proposal.label}</strong>
          <ul>
            {flow.proposal.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
          {flow.proposal.kind === "scope" && (
            <button
              type="button"
              disabled={flow.busy}
              onClick={() =>
                flow.proposal && flow.manualBoundary(flow.proposal)
              }
            >
              在地图上重画实际活动范围
            </button>
          )}
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
          <button
            type="button"
            onClick={() => (onCancelPreview ? onCancelPreview() : flow.cancel())}
          >
            撤回预览
          </button>
          {/* 2026-11-14 用户指令「给我几个方案」：物件排布方案循环切换（行列/居中/沿边），确认哪版算哪版。 */}
          {flow.proposal.kind === "objects" && (
            <button
              type="button"
              disabled={flow.busy}
              onClick={() => {
                void flow.cycleObjectsLayout();
              }}
            >
              换一种排法
            </button>
          )}
        </div>
      ) : flow.state.stage !== "place" ? (
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
      ) : null}
      {!flow.proposal &&
        !flow.busy &&
        ["main-routes", "objects", "sub-routes", "people"].includes(
          flow.state.stage,
        ) &&
        flow.unverifiedEntrances.slice(0, 1).map((n) => (
          <div key={n.id}>
            <p>
              “{n.name}
              ”需核对真实通行及进出方向：入口不自动等于出口，不代表安全认证。
            </p>
            <button
              type="button"
              onClick={() => void flow.action("verify-access", undefined, n.id)}
            >
              我已核对“{n.name}”可供本活动通行，预览标记
            </button>
            <button
              type="button"
              onClick={() =>
                void flow.action(
                  "verify-access",
                  undefined,
                  n.id,
                  undefined,
                  "exit",
                )
              }
            >
              我已核对为仅出口，预览标记
            </button>
            <button
              type="button"
              onClick={() =>
                void flow.action(
                  "verify-access",
                  undefined,
                  n.id,
                  undefined,
                  "both",
                )
              }
            >
              我已核对为双向出入口，预览标记
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
            <label style={{ display: "inline-flex", alignItems: "center", gap: 4, cursor: "pointer", opacity: 0.75, fontSize: 12 }}>
              缺物料？原位导入GLB（≤10MB，仅本会话，不上传不收费）
              {/* 2026-11-14 用户反馈：原生文件选择器裸露在流程卡里不合适——视觉隐藏（点击 label 仍弹文件框）。 */}
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
                style={{
                  position: "absolute",
                  width: 1,
                  height: 1,
                  opacity: 0,
                  overflow: "hidden",
                  clip: "rect(0 0 0 0)",
                  whiteSpace: "nowrap",
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
      {flow.proposal && (
        <footer>
          <button
            type="button"
            onClick={() => (onCancelPreview ? onCancelPreview() : flow.cancel())}
          >
            取消本次预览
          </button>
        </footer>
      )}
      {/* 「下一句」建议芯片（谷地工坊式）：空闲且无待确认提案时给，忙碌/确认中不出。 */}
      {onPrefill && !flow.busy && !flow.proposal && (STAGE_PROMPTS[flow.state.stage]?.length ?? 0) > 0 && (
        <div className="ap-stage-prompts" role="group" aria-label="下一句建议">
          {STAGE_PROMPTS[flow.state.stage]!.map((text) => (
            <button key={text} type="button" className="ap-stage-prompt" onClick={() => onPrefill(text)}>
              {text}
            </button>
          ))}
        </div>
      )}
    </section>
    {flow.loginRequired && (
      <section
        className="ap-card ap-status-card"
        role="status"
        aria-label={flow.loginSatisfied ? "登录完成" : "需要登录"}
      >
        <header className="ap-card-head">
          <strong>
            {flow.loginSatisfied ? "已登录 · 可以继续" : "需要登录 · 才能继续"}
          </strong>
        </header>
        <p className="ap-task-caption">
          <MapIcon size={13} aria-hidden="true" />
          {flow.loginSatisfied
            ? "继续后这次搜索会写入项目，结果不再只留在本页。"
            : "登录后这次搜索才写入项目；当前结果先留在本页。"}
        </p>
        {/* 2026-11-14 用户指令：登录完成后卡片切换为可继续态；恢复走 resumeAfterLogin 的既有守卫（原账户/规划未漂移）。 */}
        {flow.loginSatisfied ? (
          <button
            type="button"
            className="btn-primary"
            disabled={flow.busy}
            onClick={() => void flow.resumeAfterLogin()}
          >
            继续这次搜索
          </button>
        ) : (
          <button
            type="button"
            className="btn-primary"
            onClick={() =>
              window.dispatchEvent(new Event("scendance:request-account-login"))
            }
          >
            前往登录
          </button>
        )}
      </section>
    )}
    </>
  );
}
