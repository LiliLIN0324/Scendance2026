# Frontend proposal preview reference

Reviewed on 2026-10-02:

- [Aedifex AI preview manager](https://github.com/TangSY/aedifex/blob/main/packages/editor/src/components/ai/ai-preview-manager.ts)
- [Aedifex MIT license](https://github.com/TangSY/aedifex/blob/main/LICENSE): copyright 2026 Pascal Group Inc. and Aedifex Inc.

The reference demonstrates a temporary preview followed by confirmation or rejection, with explicit cleanup and separation from undo history. Scendance uses this interaction idea but implements its own Three.js render layer; no Aedifex code, package, scene store, or assets were copied.

`proposal-preview.ts` compares the existing and candidate layouts, creates independent translucent models and colored position outlines, and temporarily hides only affected original render meshes. Original object data, materials, selection outlines, persistence, and undo history remain intact. Closing the preview disposes its resources and restores visibility. The same overlay is usable for local arrangement candidates.

AI candidates come only from the backend response. Proposal expiration, project or draft changes, loss of editing rights, cancellation, and provider unmount remove the preview. Confirming still calls the existing proposal endpoint and uses its exact returned scene; this rendering layer cannot save or apply a proposal.

Legend: green = added, blue = changed candidate, orange = original position, red = removed. Candidate material color remains visible through the translucent model. Camera and lighting changes remain pending until confirmation; the preview layer does not change the editor's active lighting or camera.

This source review does not imply affiliation with the referenced projects. The original house-editor attribution and license remain in `frontend/UPSTREAM-LICENSE`.
