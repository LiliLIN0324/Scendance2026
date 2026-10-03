-- No application spending ceiling; retain usage accounting and request fencing.
alter table scene_private.budgets alter column limit_cents drop not null;
alter table scene_private.budgets alter column committed_cents type numeric;
update scene_private.budgets set limit_cents=null;
alter table scene_private.text_daily_budgets drop constraint text_daily_budgets_committed_cents_check;
alter table scene_private.text_daily_budgets alter column committed_cents type numeric;
alter table scene_private.text_daily_budgets add check(committed_cents>=0);

-- Patch only the quota expressions, preserving deployed RPC wrappers and grants.
do $migration$
declare definition text; target regprocedure; replacements text[][]; pair text[];
begin
  foreach target in array array['public.job_rpc_generation_v1(uuid,text,jsonb)'::regprocedure,'public.reconstruction_rpc_before_project_delete(uuid,text,jsonb)'::regprocedure] loop
    definition:=pg_get_functiondef(target);
    if target='public.job_rpc_generation_v1(uuid,text,jsonb)'::regprocedure then
      replacements:=array[
        array['v_spent integer','v_spent numeric'],
        array['where usage_day=v_day and committed_cents+20<=1000','where usage_day=v_day'],
        array['''limitCents'',1000','''limitCents'',null']
      ];
    else
      replacements:=array[
        array['spent integer','spent numeric'],
        array['where usage_day=day and committed_cents+cost<=1000','where usage_day=day']
      ];
    end if;
    foreach pair slice 1 in array replacements loop
      if strpos(definition,pair[1])=0 then raise exception 'AI_QUOTA_FUNCTION_CHANGED: %',target; end if;
      definition:=replace(definition,pair[1],pair[2]);
    end loop;
    execute definition;
  end loop;
end $migration$;
