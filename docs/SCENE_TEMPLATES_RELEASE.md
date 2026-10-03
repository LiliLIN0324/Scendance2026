# Complete scene templates release

## Scope

Requested change: add only the complete scene templates from `scene_v0.6.1` and deploy.

- Production baseline: `5279928bbf4751f1a721b54a43e11794ea61a4a6`.
- Template source: `3d4d517e30f33b315b8a226beb5bac36ab803bf1` (`scene_v0.6.1`).
- Release branch: `codex/scene-template-release`.
- Adds bar (38 objects), cafe (46), conference (212), lawn (135), market (57), museum (23), office (76), studio (24): 611 additional editable objects.
- Existing gym (307) and popup (42) remain: 10 presets and 960 editable objects in total.
- Includes original GLBs, preview images, template metadata, source attribution and compatible packaging. Fixed architecture remains separate from editable items.
- Extends preset validation without removing local layers or design history.
- Preserves the production model catalogue (528 placeable / 529 archived), Binggo, account/authentication and all Supabase code/configuration. No database migration, Edge Function deployment or Git main merge.
- Presets retain their existing local-only boundary: browser autosave; cloud saving and AI editing are not supported.

## Validation

- Frontend full regression: 132 files / 1,717 tests pass.
- Typecheck passes; lint has zero errors and one pre-existing import/order warning in `components/business/scene-preview.tsx`.
- Production Pages build passes using current production public Supabase configuration; 1,178 files, maximum 6,655,040 bytes.
- Source template files match the selected source commit. Existing model and thumbnail files and catalogue remain byte-identical.
- Real browser: all eight new scenes render with expected object counts; studio survives reload. Existing 528-model library, account entry, layer tab and Binggo entry remain present.
- Unit coverage includes all 10 templates, editable-object operations, schema round trips, existing grouped-layer operations and preservation of local layers/design history.

## Deployment and rollback

Target: https://scendance.charlestech.org (Cloudflare Pages `scendance-scene-planner`).

Pre-release deployment: `360e5c49-fcab-47ae-8aa4-0284626737ff`, https://360e5c49.scendance-scene-planner.pages.dev . This is the rollback target. Production was rechecked immediately before release preparation and still pointed to this baseline.

Deployment evidence will be recorded after publication. No Supabase release is required.
