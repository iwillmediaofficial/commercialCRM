-- Names of where leads come from (lead links, forms, imports) for every
-- member, so staff can filter and see "Link: Diwali offer". Only names: the
-- link's secret key stays admin-only.
create or replace function public.lead_origins(p_workspace_id uuid)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if not (public.is_workspace_member(p_workspace_id) or public.is_platform_admin()) then
    return jsonb_build_object('links', '[]'::jsonb, 'forms', '[]'::jsonb, 'imports', '[]'::jsonb);
  end if;
  return jsonb_build_object(
    'links', coalesce((select jsonb_agg(jsonb_build_object('id', k.id, 'name', k.name) order by k.created_at)
                       from public.lead_links k where k.workspace_id = p_workspace_id), '[]'::jsonb),
    'forms', coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'name', f.title) order by f.created_at)
                       from public.lead_forms f where f.workspace_id = p_workspace_id), '[]'::jsonb),
    'imports', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'name', i.file_name, 'at', i.created_at) order by i.created_at desc)
                         from (select * from public.lead_imports
                               where workspace_id = p_workspace_id and imported > 0
                               order by created_at desc limit 50) i), '[]'::jsonb)
  );
end;
$$;
revoke execute on function public.lead_origins(uuid) from public, anon;
grant execute on function public.lead_origins(uuid) to authenticated;
