/** Test-only listener: Fetch rejects these ports before making any request. */
import { once } from 'node:events';
import type { Server, AddressInfo } from 'node:net';

// WHATWG Fetch bad-port list, mirrored by Node's Undici implementation.
const FETCH_BAD_PORTS=new Set([1,7,9,11,13,15,17,19,20,21,22,23,25,37,42,43,53,69,77,79,87,95,101,102,103,104,109,110,111,113,115,117,119,123,135,137,139,143,161,179,389,427,465,512,513,514,515,526,530,531,532,540,548,554,556,563,587,601,636,989,990,993,995,1719,1720,1723,2049,3659,4045,4190,5060,5061,6000,6566,6665,6666,6667,6668,6669,6679,6697,10080]);
export const isFetchBlockedPort=(port:number):boolean=>FETCH_BAD_PORTS.has(port);

/** The optional predicate allows deterministic retry tests; it is not a network fallback. */
export async function listenLocalFetchSafe(server:Server,port:number,blocked:(port:number)=>boolean=isFetchBlockedPort,host='127.0.0.1'):Promise<AddressInfo>{
  if(port!==0&&blocked(port))throw new Error('Requested loopback port is blocked by Fetch');
  for(let attempt=0;attempt<16;attempt++){
    const listening=once(server,'listening');
    server.listen(port,host);
    await listening;
    const address=server.address();
    if(!address||typeof address==='string'){
      await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
      throw new Error('Missing loopback address');
    }
    if(!blocked(address.port))return address;
    await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
    if(port!==0)throw new Error('Requested loopback port is blocked by Fetch');
  }
  throw new Error('Could not allocate a Fetch-safe loopback port');
}
