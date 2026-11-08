import type {BriefMemory} from './brief-agent';

/** A deliberate postponement permits an exploratory preview, never final application. */
export function hasBlockingActivityNeeds(memory:BriefMemory,allowDeferred:boolean):boolean {
  if(memory.pendingActivityNeeds.length)return true;
  return memory.unresolvedActivityNeeds.some(kind=>!allowDeferred||!(memory.deferredActivityNeeds??[]).includes(kind));
}
