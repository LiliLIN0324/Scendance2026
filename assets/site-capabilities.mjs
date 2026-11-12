import { projects, renderImagery, drawFeature } from './site-cases.mjs';

const trial = tool => `?activity=waic&tool=${tool}#site-cases`;
const capabilities = {
  venue:['可试用','从馆外现状开始圈画布置区，馆内展位以当届图纸为准。',trial('area'),'在 WAIC 地图试用'],
  equipment:['可试用','拖放导视牌或服务台，再调方向和尺寸。',trial('item'),'试放物料'],
  measure:['可试用','量候选动线与区域。实地净宽、承载和通行条件仍要复核。',trial('measure'),'打开测距工具'],
  traffic:['布置可试用','可以画馆外候选路线。正式封路、车流预测和车证管理是对标方向。',trial('line'),'试画路线'],
  staff:['对标方向','图上显示拟设的服务岗，人员与班次关联仍待验证。','/guide','看新手指引'],
  crowd:['分区可试用','可以圈等候区、摆护栏；图示不代表当届容量或人群模拟结果。',trial('area'),'试画等候区'],
  supplier:['工作单可试用','以拟放服务台为例，进入工作台看规格、制作与到场点验。','/guide#deliver','看交付指引'],
  review:['评审可试用','可在只读方案的具体位置标意见，再导出反馈。','/guide#deliver-review','看评审指引'],
  delivery:['可试用','试排图可导出 GeoJSON。工作台另有方案平面与执行资料。','/guide#deliver','看交付指引'],
};

function node(name, attrs = {}) {
  const n = document.createElementNS('http://www.w3.org/2000/svg',name);
  for (const [key,value] of Object.entries(attrs)) n.setAttribute(key,value);
  return n;
}
function note(x,y,text) {
  const n=node('text',{x,y,class:'cap-label'});
  n.textContent=text;
  return n;
}
function point(x,y,text) {
  const n=node('g');
  n.append(node('circle',{cx:x,cy:y,r:8,class:'cap-symbol'}),note(x+12,y+4,text));
  return n;
}
function makeLayers(map) {
  const project=projects.waic;
  renderImagery(map,project,[115,139,745,432]);
  map.append(drawFeature({id:'venue',kind:'existing',name:'可辨馆体',points:project.existing},false,project));
  const [queue,sign,service,route,counter]=project.seeds;
  const draw=feature=>{
    const n=drawFeature(feature,true,project);
    if(feature.kind==='area') n.classList.add('cap-area');
    return n;
  };
  const groups={
    venue:[draw(queue),note(278,270,'拟设等候区')],
    equipment:[draw(sign),draw(counter),point(486,283,'拟放服务台')],
    measure:[node('path',{d:'M257 335v13H398v-13',class:'cap-accent'}),note(280,371,'测量候选动线')],
    traffic:[draw(route)],
    staff:[point(365,305,'拟设引导岗'),point(502,277,'拟设服务岗')],
    crowd:[draw(queue),draw(service)],
    supplier:[draw(counter),point(486,283,'服务台 · 物料工作单')],
    review:[point(411,300,'示例反馈 · 核对导视')],
    delivery:[draw(queue),draw(service),draw(route),draw(sign),draw(counter)],
  };
  Object.entries(groups).forEach(([key,items])=>{
    const g=node('g',{'data-cap-layer':key});
    g.toggleAttribute('hidden',key!=='venue');
    g.append(...items);
    map.append(g);
  });
}

function connectChoices(controls, views, controlKey, viewKey, onSelect = () => {}) {
  controls.forEach(button => button.addEventListener('click', () => {
    const selected = button.dataset[controlKey];
    controls.forEach(control => control.setAttribute('aria-pressed',String(control===button)));
    views.forEach(view => view.toggleAttribute('hidden',view.dataset[viewKey]!==selected));
    onSelect(selected);
  }));
}

const cap = document.querySelector('#process');
const link = cap.querySelector('#cap-link');
makeLayers(cap.querySelector('#cap-waic-map'));
connectChoices(cap.querySelectorAll('[data-cap]'),cap.querySelectorAll('[data-cap-layer]'),'cap','capLayer',selected => {
  const [state, detail, href, action] = capabilities[selected];
  cap.querySelector('#cap-state').textContent = state;
  cap.querySelector('#cap-detail').textContent = detail;
  link.href = href;
  link.textContent = action + ' ↗';
});
