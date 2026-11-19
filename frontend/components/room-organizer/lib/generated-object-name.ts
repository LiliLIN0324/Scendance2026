/**
 * 生成物短名：实现与 Worker 共用一份，避免画布、物料卡和入库记录各叫一个名字。
 * 具体规则与测试见 `supabase/functions/_shared/generated-object-name.ts`。
 */
export {
  GENERATED_OBJECT_NAME_MAX,
  generatedObjectName,
  generatedObjectNotes,
} from '../../../../supabase/functions/_shared/generated-object-name';
