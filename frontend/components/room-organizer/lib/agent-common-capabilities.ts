import { isExportCommand } from './workbench-agent';
import { hasMixedUtilityCommand } from './utility-shortcut-boundary';
import { matchStyleBundleCommand, type StorageLike, type StyleBundle } from './style-bundles';

export type CommonCapability = { handled: false } | { handled: true; id: 'export' } | { handled: true; id: 'style'; selection: StyleBundle | 'open' };
/** Registered, standalone UI capabilities only; unhandled keeps the entire utterance for the existing model. */
export function resolveCommonCapability(text: string, storage?: StorageLike): CommonCapability {
 if(isExportCommand(text)&&!hasMixedUtilityCommand(text))return {handled:true,id:'export'};
 const selection=matchStyleBundleCommand(text,storage);
 // Never consume a mixed requirement/question just because its substring names a style.
 if(selection&&!/[，,；;\n]|\d+\s*人|必须|不要|不想|别|是否|[?？]/u.test(text))return {handled:true,id:'style',selection};
 return {handled:false};
}
