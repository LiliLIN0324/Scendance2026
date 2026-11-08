import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {resolve} from 'node:path';
import {expect,it} from 'vitest';

it('refuses a synthetic server before launching the browser or sending a model request',async()=>{
 const requests:string[]=[];
 const server=createServer((request,response)=>{requests.push(`${request.method} ${request.url}`);response.setHeader('content-type','application/json');response.end(JSON.stringify({mode:'synthetic',state:'ready',used:0}));});
 server.listen(0,'127.0.0.1');await once(server,'listening');
 try{
  const address=server.address();if(!address||typeof address==='string')throw Error('missing address');
  const child=spawn(process.execPath,[resolve('frontend/scripts/verify-live-agent-workbench.cjs'),String(address.port),'--live'],{stdio:['ignore','pipe','pipe']});
  let output='';child.stdout.setEncoding('utf8').on('data',chunk=>output+=chunk);child.stderr.setEncoding('utf8').on('data',chunk=>output+=chunk);
  const [code]=await once(child,'exit');expect(code).not.toBe(0);expect(requests.length).toBeGreaterThan(0);expect(requests.every(request=>request==='GET /status')).toBe(true);expect(output).toContain('trial_not_ready');
 }finally{await new Promise<void>((resolveClose,reject)=>server.close(error=>error?reject(error):resolveClose()));}
},15000);
