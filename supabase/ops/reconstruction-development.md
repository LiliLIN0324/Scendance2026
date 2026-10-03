# Reconstruction development runbook

Use the independent `scendance-floorplan` checkout and a separate Supabase project or local PGlite harness. Never apply these migrations to the original project's database to preview this branch.

## Environment and worker

- `DEEPSEEK_API_KEY`: real DeepSeek credentials; only the backend reads this key.
- `RECONSTRUCTION_MAX_REQUEST_CENTS=200` or higher: conservative whole-request reservation covering a vision stage and a thinking stage, each up to 16,384 output tokens and at most 12 source images. This is a reservation, not a claim about actual billing. Recheck current provider pricing before changing production caps.
- `RECONSTRUCTION_WORKER_SECRET`: independent random bearer secret. Keep separate from the generation worker secret.
- Existing `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ALLOWED_ORIGINS` and `PUBLIC_APP_URL` must refer to the isolated environment.

Serve `scene-api` and `reconstruction-worker` using the existing Deno import map. POST to `reconstruction-worker` with `Authorization: Bearer <RECONSTRUCTION_WORKER_SECRET>` from a trusted local runner or scheduler. Each invocation atomically claims one queued job and completes its bounded pipeline. The public creation API only enqueues and returns 202. Deploying or scheduling the worker is a separate environment operation.

The shared `processReconstruction(backend, env, fetcher)` is used by both the Edge worker and the local integration runner. `Backend.readSourceBytes(path)` downloads authorized, private image bytes and transports them to the vision provider as data URLs, so localhost image addresses need not be public. Test-only backends without this method use a signed URL. Never log provider request bodies, source data URLs, credentials or signed URLs.

The independent queue shares the existing text lifetime budget and Beijing-day cap. Per-stage reservations are atomic and nonrefundable after dispatch, including ambiguous failures. Worker fencing tokens prevent duplicate application. An interrupted paid call becomes `PROVIDER_RESULT_UNKNOWN` after the claim expires; it is not silently repeated. A changed request requires a new request ID. Retry of an identical ID returns the existing job.

## Data migration

`20261003090000_scene_v2_reconstruction.sql` is additive: permits schema v2, source WebP images, project-private source references, independent reconstruction jobs and stage reservations. Existing scenes and immutable publications are not rewritten. Old clients attempting to save v1 over a v2 project receive `SCHEMA_DOWNGRADE_FORBIDDEN`. New clients read both versions. Public views remove source assets, calibration dimensions, image evidence and private notes.

Sources are limited to twelve active references per project. Uploading the same content and kind is idempotent. DELETE only unlinks the active source; immutable history and private blobs are retained. Reconstruction jobs requiring an unlinked source fail before a provider call.

## Verification and limitations

`npm exec -- vitest run tests/ --maxWorkers=2` runs the PostgreSQL contract, API, provider and geometry tests with PGlite and controlled providers. `npm run typecheck` checks shared/backend/client types. Check the Edge entry points with Deno as well.

Tests cover a deterministic 1 mm dimension consistency tolerance. That tolerance is not an accuracy guarantee for visual recognition. Global dimensions, wall-associated and evidence-backed image scales are solved, and opening dimensions can be set directly. Coupled wall-length constraints that remain inconsistent are reported for review instead of silently distorting the building. Source two-point coordinates are normalized image coordinates, and cannot establish scale without corresponding structure evidence. Photos never receive a global pixel-to-metre scale.

Model recognition always returns an editable candidate whose structural evidence requires confirmation. Known omissions, occlusion and contradictory dimensions remain in `needs_review`. Explicit item counts are checked against actual scene objects and override model assertions. An irregular prop absent from the catalogue is marked pending; the existing Hunyuan workflow can create that asset, but reconstruction does not fabricate successful Hunyuan jobs. Free-text accessibility or fabrication requirements are design inputs, not a certification.

Mocked provider success proves integration behavior only. Real image-recognition quality, model entitlement, private cloud storage and a deployed worker must be separately exercised against representative professional plans, hand drawings, one photograph and overlapping photos before marking the feature fully accepted.

Provider fields verified against official [vision](https://api-docs.deepseek.com/guides/vision/), [thinking](https://api-docs.deepseek.com/guides/thinking_mode/), and [files](https://api-docs.deepseek.com/guides/files_api/) docs on 2026-10-03. Images are currently capped at 1,024 provider tokens each; the request reserves room for text framing, all 12 images and thinking/output. When source bytes exceed 32 MiB, the worker uses the Files API so base64 does not exceed the 48 MiB request-body cap. Temporary files receive a one-hour expiry and are deleted after the attempt. Provider input/output usage is stored per stage; no chain-of-thought content is stored.

Route/aisle/egress requirements are explicitly `partial` until a separate path geometry and clearance evaluator exists. Model prose alone cannot mark these as verified; the report says that net width and connectivity need review. Exact object counts and supplied measurable dimensions are checked independently and can be satisfied.

For floorplans, arbitrary two-point segments (including diagonals) are measured using an affine image-to-world fit over at least three non-collinear same-image wall endpoints. The fit uses actual image pixel dimensions, allows translated/rotated/sheared plans, rejects degenerate transforms, and requires every endpoint's inverse-projected residual to be at most the larger of 3 pixels or 1% of the image diagonal. This evidence-consistency threshold is separate from the 1 mm computation tolerance. The transform is recomputed after uniform metre-scale solving. When whole-plan evidence is insufficient, an explicitly associated same-wall segment can still use its local evidence; a partial segment is never treated as the full wall. Contradictory evidence or an unsupported arbitrary segment requires review, and photographs are excluded from this transform.

Continuing an edited no-image review must include `reviewedJobId`; the server checks project, owner, previous review state, base hash, revision and identical source inputs.
