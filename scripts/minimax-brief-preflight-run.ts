import {minimaxBriefPreflight} from './minimax-brief-preflight.ts';
const result=await minimaxBriefPreflight();
process.stdout.write(JSON.stringify(result,null,2)+'\n');
