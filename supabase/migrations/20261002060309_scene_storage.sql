insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('scene-assets','scene-assets',false,10485760,array['model/gltf-binary','image/png','image/jpeg'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
-- No browser Storage policy is granted. Edge Functions stream bounded uploads and
-- issue 300-second signed URLs after membership or live share-token checks.
