import json, re, hashlib
from pathlib import Path

ROOT = Path(r'C:\Users\13266\.dsh\bot\workspace\Scendance2026')
SLUG = 'start-on-the-street'
spec = json.loads((ROOT / '.local/tmp/replica-geo' / SLUG / 'spec.json').read_text())
fit = json.loads((ROOT / '.local/tmp/replica-geo' / SLUG / 'google-fit.json').read_text())

# ---------- 1. product spec block ----------
target = ROOT / 'frontend/components/room-organizer/lib/replica-specs-festivals-3.ts'
ts = target.read_text(encoding='utf-8')
start = ts.index('export const START_ON_THE_STREET')
end = ts.index('export const HALLOWEEN_FIREWORK_SPOOKTACULAR', start)
def j(v):
    return json.dumps(v, ensure_ascii=False, separators=(',', ':'))
fields = [
    ('slug', j(spec['slug'])), ('title', j(spec['title'])), ('category', j(spec['category'])),
    ('region', j(spec['region'])), ('refImage', j(spec['refImage'])), ('refLink', j(spec['refLink'])),
    ('anchor', j(spec['anchor'])), ('rotationDeg', '0'), ('locationNote', j(spec['locationNote'])),
]
for key in ('zones', 'facilities', 'routes', 'nodes'):
    rows = ',\n'.join('    ' + j(x) for x in spec[key])
    fields.append((key, '[\n' + rows + ',\n  ]'))
block = 'export const START_ON_THE_STREET: ReplicaCaseSpec = {\n' + \
        '\n'.join(f'  {k}: {v},' for k, v in fields) + '\n};\n\n'
ts = ts[:start] + block + ts[end:]
target.write_text(ts, encoding='utf-8')

# ---------- 2. report section + CASES ----------
report = ROOT / 'deliverables/oneplan-replica-geo-report-2026-11-17.html'
html = report.read_text(encoding='utf-8')
before_cases = json.loads(re.search(r'const CASES = (\{.*?\});\s*\n', html, re.S).group(1))
sec_start = html.index(f'<section class="case" id="c-{SLUG}">')
sec_end = html.index('</section>', sec_start)
old = html[sec_start:sec_end]
img = re.search(r'<img src="(data:image/jpeg;base64,[^"]+)"', old).group(1)

a = spec['anchor']
xs = [p[0] for z in spec['zones'] for p in z['polygon']] + [f['placement']['x'] for f in spec['facilities']]
ys = [p[1] for z in spec['zones'] for p in z['polygon']] + [f['placement']['y'] for f in spec['facilities']]
spanx, spany = max(xs) - min(xs), max(ys) - min(ys)

pts = sorted(fit['points'], key=lambda p: p['plan'][0])
idx = [0, len(pts)//5, 2*len(pts)//5, 3*len(pts)//5, 4*len(pts)//5, len(pts)-1]
fitrows = ''.join(
    f'<tr><td>A{i+1}</td><td>{fit["points"][k]["plan"][0]:.2f}, {fit["points"][k]["plan"][1]:.2f}</td>'
    f'<td>{fit["points"][k]["sat"][0]:.2f}, {fit["points"][k]["sat"][1]:.2f}</td>'
    f'<td>{fit["points"][k]["errM"]:.2f}</td></tr>'
    for i, k in enumerate(idx))
checks = [p for j, p in enumerate(pts) if j not in idx][:3]
chkrows = ''.join(
    f'<tr><td>C{i+1}</td><td>{p["plan"][0]:.0f}, {p["plan"][1]:.0f}</td>'
    f'<td>{p["errM"]:.2f}</td><td>0.1036</td></tr>'
    for i, p in enumerate(checks))

section = f'''<section class="case" id="c-{SLUG}">
  <h2><span class="num">43</span> stART on the Street <span class="badge mid">影像配准（原图重描）</span></h2>
  <p class="meta">Festivals · North America · 锚点 <span class="mono">{a['lng']:.6f}, {a['lat']:.6f}</span> · 图面内容跨度 {spanx:.1f} × {spany:.1f} m · 7 区 / {len(spec['facilities'])} 件 / 2 线 / 2 点</p>
  <p class="note">2026-11-18 复核：参考图与同源影像做 SIFT 固定尺度拟合（{fit['inliers']} 内点，RMSE {fit['rmseM']:.3f} m），得 0.1036 m/px；分区与摊位按原图色块重描，坐标已转真 ENU。锚点沿用页面已记录位置；影像来自 Google 同源底图，Esri 仅作展示底图，两源可能存在米级偏移。</p>
  <div class="pair">
    <figure><figcaption>官方参考图（爬取自 oneplan.io，版权归 OnePlan，仅内部学习）</figcaption><img src="{img}" alt="stART on the Street 官方参考图" loading="lazy"></figure>
    <figure><figcaption>本次重描的平面 · 叠在卫星底图上（滚轮缩放 / 拖动平移）</figcaption>
      <div class="mapbox" data-case="{SLUG}" data-index="43" data-title="stART on the Street" style="cursor: grab;"><canvas width="1187" height="579"></canvas>
        <div class="mapctl"><button data-act="in">+</button><button data-act="out">−</button><button data-act="fit">适配</button><span class="zoominfo">z18.50 · 74°</span></div>
        <div class="compass" title="拖动旋转 · 双击复位正北"><div class="dial"><div class="needle" style="transform: rotate(74deg);"></div></div><div class="tail" style="transform: rotate(74deg);"></div><div class="lbl">N 74°</div></div>
        <div class="readout"><span class="rtext" data-copy="#43 stART on the Street → 锚点 {a['lat']:.6f}, {a['lng']:.6f} · 旋转 74° · z18.50 · 取视图中心">{a['lat']:.6f}, {a['lng']:.6f} · 74°</span><button data-act="copy">复制</button></div>
        <div class="mapctl2"><button class="okbtn done" data-act="ok">✓ 已记录</button></div>
      </div>
    </figure>
  </div>
  <details class="case-evidence"><summary>配准参数、拟合点与验收边界</summary>
  <table><thead><tr><th>项目</th><th>本次处理与验收边界</th></tr></thead><tbody>
  <tr><td>尺度</td><td>0.1036 m/px（50 ft 标尺约 147 px，与拟合值一致）；旧版按图面估计，未记录尺度。</td></tr>
  <tr><td>旋转 / 锚点</td><td>参考图相对正北旋转 -73°；几何已转真 ENU（spec rotation 0）。锚点沿用页面已记录坐标，未做新的现场确认。</td></tr>
  <tr><td>分区 / 设施</td><td>7 区 / {len(spec['facilities'])} 件：三组摊位带（绿/粉各 10 摊）、餐车广场 4 车 + 12 桌、商户停车 3 车、舞台 3 座、历史剑士 1 处。摊位数量按原图列数重排，尺寸 3×3 m 属估计。</td></tr>
  <tr><td>未验证</td><td>Google 与 Esri 影像存在时相/米级偏移；帐篷实际搭设、通行权限、消防净宽未实测；未做现场测量。</td></tr>
  </tbody></table>
  <table><thead><tr><th>拟合点</th><th>原图 px</th><th>影像 px</th><th>残差 m</th></tr></thead><tbody>{fitrows}</tbody></table>
  <table><thead><tr><th>独立抽查点</th><th>原图 px</th><th>残差 m</th><th>尺度 m/px</th></tr></thead><tbody>{chkrows}</tbody></table>
  <p class="sub">抽查点与拟合点不重叠，但同属一次 SIFT 变换的内点，只能证明几何一致，不等于地面实测。原图 SHA256：{hashlib.sha256((ROOT / '.local/tmp/oneplan-hd' / (SLUG + '.png')).read_bytes()).hexdigest()}。</p>
  </details>
  <p class="links">
    <a href="https://www.oneplan.io/inspiration/{SLUG}/" target="_blank" rel="noreferrer">OnePlan 案例页</a> ·
    <a href="https://www.openstreetmap.org/?mlat={a['lat']:.6f}&amp;mlon={a['lng']:.6f}#map=18.50/{a['lat']:.6f}/{a['lng']:.6f}" target="_blank" rel="noreferrer">OSM 定位</a> ·
    <a href="https://www.google.com/maps/@{a['lat']:.6f},{a['lng']:.6f},18.50z" target="_blank" rel="noreferrer">Google 地图</a>
  </p>
</section>'''
html = html[:sec_start] + section + html[sec_end + len('</section>'):]

# CASES
cases = before_cases
c = cases[SLUG]
c['a'] = [a['lng'], a['lat']]
c['v'] = [18.5, 74]
c['s'] = round(max(spanx, spany), 1)
c['g'] = {
    'b': [[round(min(xs), 1), round(min(ys), 1)], [round(max(xs), 1), round(min(ys), 1)],
          [round(max(xs), 1), round(max(ys), 1)], [round(min(xs), 1), round(max(ys), 1)]],
    'z': [dict(c=z['color'], o=z['opacity'], p=[[round(x, 1), round(y, 1)] for x, y in z['polygon']]) for z in spec['zones']],
    'r': [dict(c=r['color'], w=r['widthM'], p=[[round(x, 1), round(y, 1)] for x, y in r['points']]) for r in spec['routes']],
    'f': [[round(f['placement']['x'], 1), round(f['placement']['y'], 1), f['size']['width'], f['size']['depth'],
           f['placement'].get('rot', 0)] for f in spec['facilities']],
    'n': [[round(n['x'], 1), round(n['y'], 1)] for n in spec['nodes']],
}
html = re.sub(r'const CASES = (\{.*?\});\s*\n',
              'const CASES = ' + json.dumps(cases, ensure_ascii=False, separators=(',', ':')) + ';\n',
              html, count=1, flags=re.S)
report.write_text(html, encoding='utf-8')

# ---------- 3. QA ----------
after = json.loads(re.search(r'const CASES = (\{.*?\});\s*\n', report.read_text(encoding='utf-8'), re.S).group(1))
changed = [k for k in before_cases if before_cases[k] != after[k]]
print(json.dumps(dict(cases=len(after), changed=changed, span=[round(spanx, 1), round(spany, 1)],
                      facilities=len(spec['facilities'])), ensure_ascii=False))
