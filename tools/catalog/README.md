# tools/catalog

Rebuild, verify and audit the scene template's model library.

Everything here talks to the public [3dassets.dev](https://3dassets.dev) API and needs no credentials. Standard library only, Python 3.8+.

## What this does and does not do

The 30 local models were **picked by hand**. The pipeline harvested a broad slice
of the CC0 corpus, ranked candidates automatically, and then a human chose each
model from the shortlist.

That last step is not ceremony. Automatic scoring on this corpus picks
`Laptop riser` for a laptop and `Screen wash bucket stand` for an LED screen,
because both titles contain the right noun. The curated list in
`build_catalog.py` is therefore the source of truth, and the tool **verifies and
re-downloads** it rather than re-deriving it.

## Usage

```sh
# Check the library is intact and still valid upstream (safe, read-only)
python3 tools/catalog/build_catalog.py verify --root .

# Re-download every GLB + preview and rewrite assets/library/catalogue.json
python3 tools/catalog/build_catalog.py fetch --root .

# Harvest a fresh corpus, for reviewing candidates when a model needs replacing
python3 tools/catalog/build_catalog.py corpus --out assets/library/corpus
```

### `verify`

For each of the 30 curated models it checks that the asset:

- still resolves upstream (catches a withdrawn or renamed asset),
- is still licensed `cc0-1.0` (a licence change would make redistribution invalid),
- still avoids Draco/meshopt compression (the vendored `GLTFLoader` has no decoder),
- exists on disk as both `.glb` and `.webp`,
- has a sha256 matching the value recorded in `catalogue.json`.

It also reports non-fatal drift as notes: a changed file size upstream, a
footprint or file size that has grown past the prop limits (`MAX_SIZE_M`,
`MAX_GLB_BYTES`).

Exit code is `0` when clean, `1` when something needs a human decision.

Last run: **30 / 30 verified**, no notes, no problems.

### `fetch`

Fetches metadata first, then downloads in parallel and writes
`assets/library/catalogue.json`. Use it to rebuild the library from scratch or to
restore a deleted file.

The download rewrites the recorded `bytes` and `sha256` from the bytes actually
received, so the catalogue always describes the committed files.

### `corpus`

Harvests every published CC0 asset from the browsable categories into
`assets/library/corpus/*.json` — about 21,000 rows, roughly 9 MB. This is a
**review aid**, not a runtime dependency: the served page never reads it.

Keep it out of version control (see the repository `.gitignore`). To review
candidates for a replacement:

```sh
python3 tools/catalog/build_catalog.py corpus --out /tmp/corpus
# then grep /tmp/corpus/props.json for the noun you need
```

## Replacing a model

1. Run `verify`. It names the model that broke.
2. Run `corpus` and shortlist candidates by title.
3. Check the candidate's licence, size and triangle count in the corpus row.
4. Note its `slug`, then replace the matching entry in `CURATED`.
5. Run `fetch`, then `verify` again.
6. Update the tables in `ASSET-SOURCES.md` — the sha256 values change.

## Reference

The provider API is documented at `https://3dassets.dev/api/v1/openapi.json`.
Two behaviours worth knowing, both of which shaped this tool:

- **`?q=` is naive substring matching.** A search for `sign` also matches
  "de*sign*", so it returns whole scene environments instead of signs.
- **`?q=` ignores Chinese.** A Chinese query returns the same result set as no
  query at all.

`sort` accepts only `newest`, `popular` and `relevance`. There are 24 fixed tags
and no `plant`/`outdoor` tag, so filtering has to happen on titles rather than on
tags.
