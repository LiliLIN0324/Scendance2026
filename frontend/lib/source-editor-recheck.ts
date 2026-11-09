/** A recheck compares read-only snapshots to live editor input; it never overwrites drafts. */
type Ticket=object;
export interface SourceRecheckWriter {
 beginRead():Ticket;
 readSucceeded(ticket:Ticket):boolean;
 readFailed(ticket:Ticket):boolean;
}
export interface SourceRecheckReader {
 writer:SourceRecheckWriter;
 read():Promise<unknown>;
 matchesCurrent(value:unknown):boolean;
}
export interface SourceRecheckCoordinator {
 readonly scope:string;
 canRecheck():boolean;
 snapshot():{status:'unknown'|'settled'};
}
/** The caller's assertion must check the active capability, scope, session and notification epoch. */
export async function recheckSourceEditors(coordinator:SourceRecheckCoordinator,scope:string,
 readers:{brief:SourceRecheckReader;drawing:SourceRecheckReader;images:SourceRecheckReader},assertCurrent:()=>void):Promise<boolean>{
 const entries=[readers.brief,readers.drawing,readers.images];const tickets:{reader:SourceRecheckReader;ticket:Ticket}[]=[];
 const fail=()=>{for(const {reader,ticket} of tickets)try{reader.writer.readFailed(ticket);}catch{/* old ticket is already invalid */}};
 try{
  assertCurrent();if(coordinator.scope!==scope||!coordinator.canRecheck())return false;
  for(const reader of entries)tickets.push({reader,ticket:reader.writer.beginRead()});
  const values=await Promise.all(entries.map(reader=>reader.read()));assertCurrent();
  if(entries.some((reader,index)=>!reader.matchesCurrent(values[index]))){fail();return false;}
  assertCurrent();let success=true;
  for(const {reader,ticket} of tickets)if(!reader.writer.readSucceeded(ticket))success=false;
  assertCurrent();return success&&coordinator.snapshot().status==='settled';
 }catch{fail();return false;}
}
