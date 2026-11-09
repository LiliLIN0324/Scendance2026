// Deliberately isolated demo. This file modifies only a temporary trial copy.
// Never starts a real provider, reads credentials, or changes a real project.
const fs=require('node:fs');
const path=require('node:path');
const Module=require('node:module');
if(process.env.SCENDANCE_CHAT_TRIAL_MODE&&process.env.SCENDANCE_CHAT_TRIAL_MODE!=='synthetic')throw Error('此案例只支持隔离模拟模式。');
process.env.SCENDANCE_CHAT_TRIAL_MODE='synthetic';
delete process.env.SCENDANCE_CHAT_TRIAL_KEY;
delete process.env.SCENDANCE_CHAT_TRIAL_CONFIRM;
const original=path.join(__dirname,'local-chat-trial.cjs');
let launcher=fs.readFileSync(original,'utf8');
function replaceExactly(source,needle,replacement){if(source.split(needle).length!==2)throw Error('隔离演练启动器版本不匹配。');return source.replace(needle,replacement);}

// Both the container and direct app response prohibit downloads and popups.
// The workspace copy gets its own permanent in-page label; production is untouched.
const injection=String.raw`
 const configPath=path.join(dest,'frontend/next.config.mjs');let config=fs.readFileSync(configPath,'utf8');
 const configNeedle="  reactStrictMode: true,";
 if(config.split(configNeedle).length!==2)throw Error('模拟案例配置版本不匹配。');
 config=config.replace(configNeedle,"  async headers() { return [{ source: '/:path*', headers: [{ key: 'Content-Security-Policy', value: 'sandbox allow-scripts allow-same-origin allow-forms' }] }]; },\n"+configNeedle);
 fs.writeFileSync(configPath,config);
 const layoutPath=path.join(dest,'frontend/app/layout.tsx');let layout=fs.readFileSync(layoutPath,'utf8');
 const bodyNeedle='<Suspense fallback={<BootSkeleton />}>';
 if(layout.split(bodyNeedle).length!==2)throw Error('模拟案例页面版本不匹配。');
 layout=layout.replace(bodyNeedle,'<div role="note" data-testid="g402-simulation-banner" style={{position:"fixed",top:0,right:0,zIndex:2147483000,background:"#F4F5F7",color:"#244936",border:"2px solid #4A7C59",padding:"6px 12px",fontSize:14,fontWeight:700,pointerEvents:"none",maxWidth:"65vw"}}>模拟案例：G402 仅作公开参考；14.2×10 米为虚构矩形，桌椅为示意规格，库存未接入，场地方未确认。应用内下载受限；截图或浏览器保存时请保留本说明。</div>'+bodyNeedle);
 fs.writeFileSync(layoutPath,layout);
`;
launcher=replaceExactly(launcher,' return dest;\n}',injection+'\n return dest;\n}');
launcher=replaceExactly(launcher,'<strong>${label}</strong>',
 '<strong>模拟案例（固定模拟模型，不调用真实模型）：G402 公开参考；14.2×10 米为虚构矩形，15 桌/30 椅仅为虚构库存样例、未接入核对；场地方未确认；应用内下载受限。</strong>');
launcher=replaceExactly(launcher,'<iframe title="幕景工作台" src="${nextOrigin}"></iframe>',
 '<iframe title="幕景工作台" sandbox="allow-scripts allow-same-origin allow-forms" src="${nextOrigin}"></iframe>');
const loaded=new Module(original,module);loaded.filename=original;loaded.paths=module.paths;loaded._compile(launcher,original);
