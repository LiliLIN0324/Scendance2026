import {createServer} from 'node:http';
import {describe,expect,it} from 'vitest';
import {isFetchBlockedPort,listenLocalFetchSafe} from './local-loopback.ts';

describe('isolated loopback fixture port selection',()=>{
  it('recognizes Fetch-blocked ports without issuing a request',async()=>{
    expect([6000,6666,10080].every(isFetchBlockedPort)).toBe(true);
    expect(isFetchBlockedPort(49152)).toBe(false);
    const server=createServer();
    await expect(listenLocalFetchSafe(server,6000)).rejects.toThrow('blocked by Fetch');
    expect(server.listening).toBe(false);
  });
  it('closes a rejected ephemeral port and listens again only on loopback',async()=>{
    const server=createServer((_req,res)=>res.end('fixture'));
    let checks=0;
    try{
      const address=await listenLocalFetchSafe(server,0,port=>++checks===1||isFetchBlockedPort(port));
      expect(checks).toBeGreaterThanOrEqual(2);
      expect(address.address).toBe('127.0.0.1');
      expect(isFetchBlockedPort(address.port)).toBe(false);
      expect(await(await fetch(`http://127.0.0.1:${address.port}`)).text()).toBe('fixture');
    }finally{if(server.listening)await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
  });
  it('stops after a bounded number of rejected ephemeral assignments',async()=>{
    const server=createServer();let checks=0;
    await expect(listenLocalFetchSafe(server,0,()=>{checks++;return true;})).rejects.toThrow('Could not allocate');
    expect(checks).toBe(16);expect(server.listening).toBe(false);
  });
});
