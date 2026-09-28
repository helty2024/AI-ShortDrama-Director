# 0.8 Creator UI · Step 08-04 Assets

The top-level **资产** page is a unified Creator workspace with 角色 / 场景 / 道具 tabs. A Creator Asset is an existing Character, Location, or Prop entity. It is not a raw media Asset: raw Assets and AssetVersions provide its reference images and candidates. The former raw media library and VisualPanel/AssetReview remain reachable through **验收与维护 → 旧版兼容入口**; they are not embedded in the Creator Inspector.

## Resolution and actions

- A current primary image is resolved only from `visualReferences.find(primary)` → matching image Asset → `approvedVersionId` → approved image AssetVersion. A broken link is **不可用**, never silently replaced with a newer image. Without a primary, a candidate may be previewed only with an explicit **候选** badge.
- Related candidates come from the entity's `visualReferences` or `assetIds`, an image version's `metadata.targetId`, or a target-bound AI task's `resultIds`. Only PNG/JPEG/WebP image versions enter this flow; videos do not. Candidate versions are deduplicated by version ID. The primary raw Asset's other versions and rejected versions go to history, not the ordinary approve/adopt controls.
- Status is deterministic: valid primary **已确认**; broken primary **不可用**; approved adoptable candidate **准备就绪**; draft candidate **待审核**; otherwise **待生成**. Bible or description length does not affect it.
- **批准** calls `version.review` with `targetId: null` and the version's `expectedRevision`. It approves that raw candidate Asset's version only; it does not modify the Creator entity's primary reference. **拒绝** also preserves media and history. **设为主参考** is a separate `references.save` call with the entity's `expectedRevision`: it requires an approved candidate equal to its raw Asset's `approvedVersionId`, retains the candidate reference's existing role when present, adds a default role otherwise, and leaves exactly one primary. Revision conflicts surface as errors, not silent overwrites. The page reloads the workspace and shows a success toast after adoption.

## Import semantics

**导入参考图** uses the existing `asset.import` command with `assetId: null` and the selected Creator entity as `targetId`. Every such import creates a new raw Asset and its own AssetVersion, even if another Asset holds identical bytes and hash. Hash is content identity/provenance, not Creator Asset identity. When an explicit `assetId` is passed, same-content deduplication is limited to that Asset's versions; it never reuses another Asset. Physical files may remain duplicated; this step does not add shared-blob storage.

Import attaches a non-primary reference with the default role (Character `faceReference`; Location/Prop `masterReference`) only when that raw Asset is not already referenced. Reimporting an already referenced Asset preserves its role and primary flag. Import never promotes, demotes, or switches a primary. The Legacy import interface still works with its explicit-Asset version path, subject to these corrected identity/reference rules; no Legacy command or schema shape changed.

## Interaction and limits

The Grid searches name and description locally, filters by Creator status, and uses the existing entity-create modal. Selecting a card stores its Creator entity ID and kind in renderer-only Creator Context. Tabs clear cross-kind selection. **生成参考图** carries `targetKind` and `targetId` into the Generate destination for 08-05; it does not perform generation here.

The shared ContextInspector shows the existing Bible editor, Character appearance, the current primary, other reference roles with Chinese labels, candidates, at most two large comparison images, history, and provenance. Source details show a short summary first; technical lineage, IDs, metadata, and prompt are folded away. Legacy lineage is presented as `Legacy / provenance unavailable` rather than invented provenance. Character appearance is currently displayed read-only because existing `bible.save` does not edit that separate field; this step does not introduce a second model or CRUD path.

At 1920 pixels, selecting a card opens the existing Inspector Overlay without reducing Grid width; Escape closes it. The page does not add raw Asset deletion, a provider form, workflow controls, or production architecture. Package remains **0.7.0**, database schema **10**, and backup format **5**.
