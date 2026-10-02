import { afterAll,describe,it,expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync,readFileSync,rmSync,writeFileSync,existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory=mkdtempSync(join(tmpdir(),'scene-config-'));
const script=fileURLToPath(new URL('../scripts/check-config.mjs',import.meta.url));
const core={SUPABASE_URL:'http://127.0.0.1:54321',SUPABASE_SERVICE_ROLE_KEY:'private-test-key',SUPABASE_PUBLISHABLE_KEY:'public-test-key',PUBLIC_APP_URL:'http://localhost:3000',ALLOWED_ORIGINS:'http://localhost:3000',GENERATION_WORKER_SECRET:'a-separate-random-test-token-with-32-bytes'};
const providers={DEEPSEEK_API_KEY:'deepseek-private-test-key',AI_MAX_REQUEST_CENTS:'40',HUNYUAN_API_KEY:'hunyuan-private-test-key',GENERATION_MAX_TASK_CENTS:'100',HUNYUAN_TERMS_URL:'https://example.com/terms',HUNYUAN_TERMS_REVIEWED_AT:'2020-01-01'};
const demo={DEMO_STUDIO_ID:'cf214d55-1d5a-48c0-b2b0-fe0f4d9848f2',DEMO_STUDIO_NAME:'Demo',DEMO_OWNER_EMAIL:'owner@example.com',DEMO_OWNER_PASSWORD:'owner-test-password',DEMO_EDITOR_EMAIL:'editor@example.com',DEMO_EDITOR_PASSWORD:'editor-test-password'};
function check(env:Record<string,string>={},args:string[]=[]) {
  const result=spawnSync(process.execPath,[script,...args],{cwd:directory,env:{PATH:process.env.PATH,...env},encoding:'utf8'});
  return {status:result.status,output:result.stdout+result.stderr};
}
afterAll(()=>rmSync(directory,{recursive:true,force:true}));

describe('offline backend configuration preflight',()=>{
  it('reports missing fields without reading unrelated environment values',()=>{
    const result=check({UNRELATED_SECRET:'never-print-this-secret'});
    expect(result.status).toBe(1);
    for(const key of ['SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','SUPABASE_PUBLISHABLE_KEY','PUBLIC_APP_URL','ALLOWED_ORIGINS','GENERATION_WORKER_SECRET']) expect(result.output).toContain(key);
    expect(result.output).not.toContain('never-print-this-secret');
  });
  it('allows localhost core service with optional providers disabled and a default demo name',()=>{
    const result=check({...core,DEMO_STUDIO_NAME:'演示活动工作室'});
    expect(result.status).toBe(0);expect(result.output).toContain('AI: disabled; 3D generation: disabled');
  });
  it('accepts production HTTPS origins and multiple explicit allowed origins',()=>{
    expect(check({...core,SUPABASE_URL:'https://example.supabase.co',PUBLIC_APP_URL:'https://app.example.com',ALLOWED_ORIGINS:'https://app.example.com, http://localhost:3000'}).status).toBe(0);
  });
  it.each(['http://app.example.com','https://app.example.com/path','https://app.example.com/','https://user:password@app.example.com','https://app.example.com?x=y','https://app.example.com#part','https://*.example.com'])('rejects unsafe or non-exact origins: %s',value=>{
    expect(check({...core,PUBLIC_APP_URL:value,ALLOWED_ORIGINS:value}).status).toBe(1);
  });
  it.each(['*','http://localhost:3000,','https://unrelated.example'])('rejects unsafe or incomplete CORS allowlists: %s',value=>{
    const result=check({...core,ALLOWED_ORIGINS:value});expect(result.status).toBe(1);expect(result.output).toContain('ALLOWED_ORIGINS');
  });
  it('rejects short and reused worker secrets without printing them',()=>{
    for(const secret of ['short-worker-token',core.GENERATION_WORKER_SECRET]) {
      const result=check({...core,GENERATION_WORKER_SECRET:secret,SUPABASE_SERVICE_ROLE_KEY:core.GENERATION_WORKER_SECRET});
      expect(result.status).toBe(1);expect(result.output).toContain('GENERATION_WORKER_SECRET');expect(result.output).not.toContain(secret);
    }
  });
  it('does not allow service credentials to be used as public client credentials',()=>{
    const jwt=`e30.${Buffer.from(JSON.stringify({role:'service_role'})).toString('base64url')}.signature`;
    for(const key of [core.SUPABASE_SERVICE_ROLE_KEY,'sb_secret_not-a-public-key',jwt]) {
      const result=check({...core,SUPABASE_PUBLISHABLE_KEY:key});expect(result.status).toBe(1);expect(result.output).not.toContain(key);
    }
    expect(check({...core,SUPABASE_PUBLISHABLE_KEY:'',SUPABASE_ANON_KEY:'public-anon-test-key'}).status).toBe(0);
  });
  it('requires all provider fields in full mode and rejects partial optional providers in core mode',()=>{
    const full=check(core,['--mode','full']);expect(full.status).toBe(1);
    for(const key of Object.keys(providers)) expect(full.output).toContain(key);
    for(const key of ['DEEPSEEK_API_KEY','HUNYUAN_API_KEY'] as const) expect(check({...core,[key]:providers[key]}).status).toBe(1);
    expect(check({...core,...providers},['--mode','full']).status).toBe(0);
  });
  it('validates the Hunyuan API mode without enabling an unconfigured provider',()=>{
    for(const mode of ['tokenhub','legacy']) expect(check({...core,HUNYUAN_API_MODE:mode}).status).toBe(0);
    const result=check({...core,HUNYUAN_API_MODE:'unknown'});expect(result.status).toBe(1);expect(result.output).toContain('HUNYUAN_API_MODE');
  });
  it('rejects invalid cost amounts and amounts above the current SQL budgets',()=>{
    const migration=readFileSync(new URL('../supabase/migrations/20261002060307_scene_jobs.sql',import.meta.url),'utf8');
    const limits={AI_MAX_REQUEST_CENTS:Number(migration.match(/\('text',(\d+)\)/)?.[1]),GENERATION_MAX_TASK_CENTS:Number(migration.match(/\('generation',(\d+)\)/)?.[1])};
    for(const [key,limit] of Object.entries(limits)) {
      expect(Number.isSafeInteger(limit)).toBe(true);
      expect(check({...core,...providers,[key]:String(limit)}).status).toBe(0);
      for(const value of ['0','-1','1.5','NaN','1e2',String(limit+1),...(key==='AI_MAX_REQUEST_CENTS'?['39']:[])]) {
        const result=check({...core,...providers,[key]:value});expect(result.status).toBe(1);expect(result.output).toContain(key);
      }
    }
  });
  it.each(['2025-02-30','9999-01-01','2026/01/01','2020-01-01T00:00:00Z','not-a-date'])('rejects invalid or future provider review dates: %s',value=>{
    expect(check({...core,...providers,HUNYUAN_TERMS_REVIEWED_AT:value}).status).toBe(1);
  });
  it.each(['http://example.com/terms','file:///terms','https://name:password@example.com/terms'])('requires secure provider terms URLs: %s',value=>{
    expect(check({...core,...providers,HUNYUAN_TERMS_URL:value}).status).toBe(1);
  });
  it('validates demo identity, independent passwords and case-insensitive email collisions',()=>{
    expect(check({...core,...demo},['--demo']).status).toBe(0);
    for(const override of [{DEMO_STUDIO_ID:'not-a-uuid'},{DEMO_OWNER_EMAIL:'bad'},{DEMO_OWNER_EMAIL:'EDITOR@example.com'},{DEMO_OWNER_PASSWORD:'short'},{DEMO_EDITOR_PASSWORD:demo.DEMO_OWNER_PASSWORD}]) {
      const result=check({...core,...demo,...override});expect(result.status).toBe(1);
      expect(result.output).not.toContain(demo.DEMO_OWNER_PASSWORD);expect(result.output).not.toContain(demo.DEMO_EDITOR_PASSWORD);
    }
    expect(check(core,['--demo']).status).toBe(1);
    expect(check({...core,DEMO_OWNER_EMAIL:demo.DEMO_OWNER_EMAIL}).status).toBe(1);
  });
  it('parses explicit env files without shell execution or interpolation; process values take priority',()=>{
    const marker=join(directory,'must-not-exist'),first=join(directory,'first.env'),second=join(directory,'second.env'),hook=join(directory,'hook.cjs');
    writeFileSync(hook,`require('node:fs').writeFileSync(${JSON.stringify(marker)},'executed')`);
    writeFileSync(first,Object.entries(core).map(([key,value])=>`${key}=${value}`).join('\n')+`\nNODE_OPTIONS=--require ${hook}\nUNRELATED_SECRET=$(touch ${marker})\nDEEPSEEK_API_KEY=\`touch ${marker}\`\nAI_MAX_REQUEST_CENTS=40\n`);
    writeFileSync(second,'PUBLIC_APP_URL=https://app.example.com\nALLOWED_ORIGINS=https://app.example.com\n');
    const result=check({PUBLIC_APP_URL:core.PUBLIC_APP_URL,ALLOWED_ORIGINS:core.ALLOWED_ORIGINS},['--env',first,'--env',second]);
    expect(result.status).toBe(0);expect(existsSync(marker)).toBe(false);expect(result.output).not.toContain(marker);
    writeFileSync(second,'PUBLIC_APP_URL=${PUBLIC_APP_URL}\n');
    expect(check({},['--env',first,'--env',second]).status).toBe(1);
  });
  it('fails clearly for unreadable explicit env files and invalid CLI usage without echoing arguments',()=>{
    const value='never-echo-untrusted-arguments';
    for(const args of [['--env',join(directory,value)],['--mode',value],[`--${value}`]]) {
      const result=check(core,args);expect(result.status).toBe(1);expect(result.output).not.toContain(value);
    }
  });
});
