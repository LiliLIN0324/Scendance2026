'use client';

import dynamic from 'next/dynamic';
import { useMemo, useRef, useState } from 'react';
import { GardenPlan } from './garden-plan';
import { change, gardenLayout, handoffs, nodes, steps, type NodeId, type Version } from './garden-sample';
import styles from './garden.module.css';

const LayoutPreview = dynamic(() => import('@/components/business/layout-preview').then(module => module.LayoutPreview), {
  ssr: false,
  loading: () => <p className={styles.loading} role="status">正在打开三维布置预览…</p>,
});
const assets = {};

export function GardenCase() {
  const [step, setStep] = useState(0);
  const [selected, setSelected] = useState<NodeId>('A01');
  const [version, setVersion] = useState<Version>('A');
  const [role, setRole] = useState(0);
  const [showSuggestion, setShowSuggestion] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [show3D, setShow3D] = useState(false);
  const [guideMoved, setGuideMoved] = useState(false);
  const [webglNotice, setWebglNotice] = useState('');
  const layout = useMemo(() => gardenLayout(guideMoved), [guideMoved]);
  const planRef = useRef<HTMLDivElement>(null);
  const node = nodes.find(exhibit => exhibit.id === selected) ?? nodes[0];
  const handoff = handoffs[role];
  const mapVersion = step === 3 ? version : 'B';
  const affected = node.id === change.node.id;
  const revision = confirmed ? 'R02 · 模拟已确认' : 'R02 · 待确认草稿';

  function navigate(next: number) {
    setStep(next);
    if (next >= 3) setSelected(change.node.id);
  }

  function locateChange() {
    setSelected(change.node.id);
    planRef.current?.focus();
  }

  function openThree() {
    if (document.createElement('canvas').getContext('webgl2')) {
      setShow3D(true);
      setWebglNotice('');
    } else {
      setWebglNotice('这台设备暂时无法打开三维预览，可以继续用平面图查看布置。');
    }
  }

  return <main className={styles.case}>
    <header className={styles.masthead}>
      <div className={styles.wrap}>
        <a className={styles.brand} href="/introduction" aria-label="幕景官网">
          <svg width="28" height="28" viewBox="0 0 48 48" aria-hidden="true">
            <path fill="currentColor" fillRule="evenodd" d="M14 4H34A10 10 0 0 1 44 14V34A10 10 0 0 1 34 44H14A10 10 0 0 1 4 34V14A10 10 0 0 1 14 4ZM14 44V34A10 10 0 0 1 34 34V44Z" />
            <circle cx="24" cy="35" r="5" fill="#9ab185" />
          </svg>
          <strong>幕景</strong><span><i>S</i>CENDANCE</span>
        </a>
        <a className={styles.back} href="/introduction">← 返回官网</a>
      </div>
    </header>

    <div className={styles.wrap}>
      <section className={styles.intro} aria-labelledby="garden-title">
        <div>
          <p className={styles.badge}>幕景自制模拟 · 参考公开花展流程</p>
          <h1 id="garden-title">园林花展布置与换花</h1>
          <p>作为主办与制作团队，在同一张园区图上定展点、排进场，处理一次补花，再把方案交到三个岗位手里。</p>
          <a className={styles.realSite} href="/cases/garden-flower-show/yuquan">打开真实场地试排 · 玉泉鱼跃 ↗</a>
        </div>
        <div className={styles.folio} aria-hidden="true"><span>SCENDANCE / CASE STUDY</span><strong>01</strong><span>秋圃示范园 · 未来工作流</span></div>
      </section>

      <nav className={styles.steps} aria-label="筹办步骤">
        {steps.map((entry, index) => <button key={entry.title} type="button" aria-current={step === index ? 'step' : undefined} onClick={() => navigate(index)}>
          <span className={styles.stepNumber}>0{index + 1}</span>
          <span><strong>{entry.title}</strong><small>{entry.detail}</small></span>
        </button>)}
      </nav>

      <div className={styles.workspace}>
        <section className={styles.mapCard} aria-labelledby="garden-map">
          <header className={styles.cardHeader}>
            <div><p className={styles.kicker}>示范园区 / {step === 4 ? handoff.sheet : steps[step].title}</p><h2 id="garden-map">秋圃示范园</h2></div>
            {step === 1 ? <div className={styles.switcher} role="group" aria-label="空间视图">
              <button type="button" aria-pressed={!show3D} onClick={() => setShow3D(false)}>平面</button>
              <button type="button" aria-pressed={show3D} onClick={openThree}>三维预览</button>
            </div> : step === 3 ? <div className={styles.switcher} role="group" aria-label="补花方案对照">
              <button type="button" aria-pressed={version === 'A'} onClick={() => { setVersion('A'); setSelected(change.node.id); }}>A · 变更前</button>
              <button type="button" aria-pressed={version === 'B'} onClick={() => { setVersion('B'); setSelected(change.node.id); }}>B · 补花预案</button>
            </div> : step === 4 ? <div className={styles.mapControls}>
              <span className={styles.tag}>{revision}</span>
              <div className={styles.switcher} role="group" aria-label="交接岗位">
                {handoffs.map((entry, index) => <button type="button" key={entry.name} aria-pressed={role === index} onClick={() => { setRole(index); setSelected(change.node.id); }}>{entry.name}</button>)}
              </div>
            </div> : <span className={styles.tag}>原创示意底图</span>}
          </header>
          {webglNotice && step === 1 && <p className={styles.notice} role="status">{webglNotice}</p>}
          <div className={styles.mapFrame} ref={planRef} tabIndex={-1} aria-label="展点定位">
            {step === 1 && show3D ? <LayoutPreview layout={layout} assetUrls={assets} name="秋圃示范园布置示意" /> :
              <GardenPlan selected={selected} select={setSelected} version={mapVersion} compare={step >= 3} boundary={step === 0} guideMoved={guideMoved} handoffRole={step === 4 ? role : null} />}
          </div>
          <div className={styles.legend}>
            <span><i className={styles.pathKey} />主园路</span>
            <span><i className={styles.plotKey} />展陈范围</span>
            {step === 0 && <span><i className={styles.boundaryKey} />项目边界</span>}
            {step >= 3 && mapVersion === 'A' && <span><i className={styles.issueKey} />待换花材</span>}
            {step >= 3 && mapVersion === 'B' && <span><i className={styles.newKey} />补花区</span>}
            {step === 4 && role === 0 && <span><i className={styles.stockKey} />备花运送路线</span>}
            {step === 4 && role === 1 && <span><i className={styles.issueKey} />临时围挡边界</span>}
            {((step === 3 && version === 'B') || (step === 4 && role === 2)) && <span><i className={styles.detourKey} />作业期间临时导览</span>}
          </div>
          <div className={styles.nodeList} role="group" aria-label="选择展点">
            {nodes.map(exhibit => <button type="button" key={exhibit.id} aria-pressed={selected === exhibit.id} onClick={() => {
              setSelected(exhibit.id);
              if (step === 1) setShow3D(false);
            }}><span>{exhibit.id}</span>{exhibit.name}</button>)}
          </div>
        </section>

        <section className={styles.inspector} aria-labelledby="garden-step">
          <header className={styles.inspectorHeader}>
            <p className={styles.kicker}>筹办步骤 <span>0{step + 1} / 05</span></p>
            <h2 id="garden-step">{steps[step].title}</h2>
          </header>
          <div className={styles.inspectorBody}>
            {step === 0 && <>
              <p>沿南入口进入园区，主园路串起三种展陈。北侧支路可用于临时绕行，备花点靠近东侧园路。</p>
              <dl className={styles.facts}>
                <div><dt>场地底图</dt><dd>自绘园区 · 72 × 46 米图幅</dd></div>
                <div><dt>项目范围</dt><dd>图中虚线以内</dd></div>
                <div><dt>筹办分工</dt><dd>主办、制作、园艺、现场与导览</dd></div>
              </dl>
            </>}
            {step === 1 && <>
              <p>选中平面里的展点，核对展陈占地、配套设施和布置状态。</p>
              <dl className={styles.facts}>
                <div><dt>展陈类型</dt><dd>{node.kind}</dd></div>
                <div><dt>占地尺寸</dt><dd>{node.width} × {node.depth} 米</dd></div>
                <div><dt>布置状态</dt><dd>已定位 · 待布展</dd></div>
                <div><dt>临时设施</dt><dd>{guideMoved ? '导视在北侧支路口' : '导视在南入口'} · 东侧备花点</dd></div>
              </dl>
              <div><button className={styles.secondary} type="button" onClick={() => { setGuideMoved(value => !value); setShow3D(false); }}>
                {guideMoved ? '把导视移回南入口' : '把导视移到北侧支路口'}
              </button></div>
            </>}
            {step === 2 && <>
              <p>布展日 07:00 在备花点统一收货。点选时段，查看对应展点与到货批次。</p>
              <div className={styles.schedule} role="group" aria-label="布展时段">
                {nodes.map(exhibit => <button type="button" key={exhibit.id} aria-pressed={selected === exhibit.id} onClick={() => setSelected(exhibit.id)}>
                  <strong>{exhibit.slot}</strong><span>{exhibit.id} · {exhibit.team}</span>
                </button>)}
              </div>
              <dl className={styles.facts}>
                <div><dt>到货批次</dt><dd>{node.batch} · {node.material} {node.count} 盆</dd></div>
                <div><dt>现场任务</dt><dd>{node.task}</dd></div>
                <div><dt>留作备花</dt><dd>{change.reserve} · 同色系小菊 {change.quantity} 盆</dd></div>
              </dl>
            </>}
            {step === 3 && <>
              <p>展期第 2 天，晨检发现 B02 前沿 {change.quantity} 盆积水倒伏。切换方案，查看补花与绕行的变化。</p>
              <dl className={styles.facts}>
                <div><dt>展点</dt><dd>B02 · 层叠菊台</dd></div>
                <div><dt>花材</dt><dd>{version === 'A' ? 'CH-02 共 36 盆，12 盆待换' : '保留 CH-02 的 24 盆，换入 CH-04 的 12 盆'}</dd></div>
                <div><dt>养护与导览</dt><dd>{version === 'A' ? '待安排替换与复核，图中保留原导览' : '替换、隔离撤下花材并复核排水，作业期间绕行 B02'}</dd></div>
              </dl>
              <div className={styles.actions}>
                <button type="button" className={styles.secondary} onClick={locateChange}>定位 B02</button>
                <button type="button" className={styles.secondary} aria-expanded={showSuggestion} aria-controls="garden-suggestion" onClick={() => setShowSuggestion(value => !value)}>{showSuggestion ? '收起 AI 建议' : '查看模拟 AI 建议'}</button>
              </div>
              <div className={styles.suggestion} id="garden-suggestion" hidden={!showSuggestion}>
                <h3>模拟 AI 建议</h3>
                <p>{change.suggestion}</p>
                <h4>依据（演示记录）</h4>
                <ul>{change.evidence.map(entry => <li key={entry}>{entry}</li>)}</ul>
                <h4>待人工确认</h4>
                <p>{change.checks}</p>
              </div>
              {confirmed ? <p className={styles.confirmed} role="status">已模拟确认方案 B。交接图已标为 R02，现场复核仍列为待办。</p> :
                <button type="button" className={styles.primary} disabled={version !== 'B'} onClick={() => setConfirmed(true)}>模拟人工确认方案 B</button>}
            </>}
            {step === 4 && <>
              <p>按岗位预览同一版本的图和待办。三份交接都指向 B02，收到现场组确认后才恢复导览。</p>
              <div className={styles.handoff}>
                <p className={styles.kicker}>{revision}</p>
                <h3>{handoff.sheet}</h3>
                <ol>{handoff.tasks.map(task => <li key={task}>{task}</li>)}</ol>
              </div>
              <button type="button" className={styles.secondary} onClick={locateChange}>定位交接展点 B02</button>
            </>}
            <div className={styles.selected} aria-live="polite">
              <span>当前选中</span><strong>{node.id} · {node.name}</strong>
              <small>{step >= 3 ? (affected ? '本次变更涉及此展点' : '本次变更未涉及此展点') : node.kind}</small>
            </div>
          </div>
          <div className={styles.stepFooter}>
            {step > 0 && <button type="button" className={styles.secondary} onClick={() => navigate(step - 1)}>← 上一步</button>}
            {step < steps.length - 1 && <button type="button" className={styles.primary} onClick={() => navigate(step + 1)}>下一步 · {steps[step + 1].title} →</button>}
          </div>
        </section>
      </div>

      <footer className={styles.notes}>
        <div><h2>现有工作台</h2><p>支持平面与三维布置、摆放物料、方案评审与交付导出。空间布局中的三维预览沿用幕景现有只读查看器，花盆模型为示意。</p></div>
        <div><h2>未来版概念演示</h2><p>园区、批次、养护任务、AI 建议与交接版本均为自制样例。确认只更新当前页面。</p>
          <p>流程研究参考杭州植物园 2026 年杭州菊花艺术展的公开展区与采购资料。<br />
            <a href="https://hznews.hangzhou.com.cn/wenti/content/2026-11/04/content_9366713.htm" target="_blank" rel="noreferrer">开幕报道 ↗</a>{' · '}
            <a href="https://m.bidcenter.com.cn/news-1-442758687.html" target="_blank" rel="noreferrer">布展与养护招标公告转载 ↗</a>
          </p>
        </div>
      </footer>
    </div>
  </main>;
}
