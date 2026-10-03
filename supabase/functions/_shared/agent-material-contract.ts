import {z} from 'zod';
import {uuid} from './domain.ts';
import {materialChangeSchema} from './asset-customization-contract.ts';

export const materialSuggestionSchema=z.strictObject({
  objectIds:z.array(uuid).min(1).max(50).refine(ids=>new Set(ids).size===ids.length),
  name:z.string().trim().min(1).max(120),reason:z.string().trim().min(1).max(500),
  scope:z.enum(['all_materials','choose_materials']),changes:materialChangeSchema,
});
export const resolvedMaterialSuggestionSchema=materialSuggestionSchema.extend({sourceAssetId:uuid});
export type MaterialSuggestion=z.infer<typeof resolvedMaterialSuggestionSchema>;
