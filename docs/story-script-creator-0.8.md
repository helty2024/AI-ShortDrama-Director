# 0.8 Creator UI · Step 08-03 Story + Script

This is a development step on `main`, not a 0.8 release. The package remains `0.7.0`; the v0.7.0 tag and release are unchanged.

## Story data and migration

Story is the existing Project, not a new entity. Alongside name, description (story synopsis, max 4000), genre, aspectRatio and language, Project now persists `logline` (max 1000), `style` (max 2000), `worldview` (max 10000) and `creativeRequirements` (max 10000). New and legacy projects default these four fields to empty strings. The v9→v10 SQLite migration updates only the Project JSON and `PRAGMA user_version`. It preserves IDs, revisions, timestamps and all other tables. The existing v6→v9 migrations still run before v10 when opening older databases. Reopening an already migrated v10 database does not repeat the migration.

Backup now writes format 5/schema 10 and includes the complete Project JSON. Restore accepts format 1/schema 6 through format 5/schema 10. Older backups receive empty Story fields in the restored Project. Tasks, approvals, reservations and workflows remain historical/read-only on restore; no recovered workflow execution authority is granted. Backup does not export credential or arbitrary settings data.

## Story page

The Story compatibility summary is replaced by an editable writing page: name, one-line concept, synopsis, genre, style, worldview and creative requirements, with aspect ratio and language secondary. An empty concept invites writing directly. “进入剧本” navigates without a gate. The shared Shell TopBar reports save state. Edits use the existing `projects.update` Workspace service with `expectedRevision`, a 650 ms debounce, validation and conflict protection. Failed edits remain in the editor until the user reloads or resolves them; navigation guards against abandoning unsaved changes. The shared Inspector shows project attributes, updated time and a short concept summary, not the full synopsis.

## Script page

The left column is a 254 px Script/Episode/Scene structure with selection, create, rename, delete and reorder actions. The center retains the existing `SceneEditor` and its autosave, undo/redo, conflict and revision semantics. No Scene schema was changed. The current Scene content supports sceneNumber, heading, interiorExterior, location, timeOfDay, characters, action, dialogue, narration and notes. The UI labels existing `notes` as “导演说明 / 备注”; it does not invent a separate director-notes field. Import, AI breakdown, draft review, Bible and task actions remain available inside a collapsed contextual section below the editor; they no longer occupy a permanent right rail. A link to Assets uses the existing Creator navigation and does not implement the 08-04 Assets page.

Scene selection is held by `CreatorContext` across Story/Script navigation while the Scene exists. Invalid IDs are normalized away when entities change. The shared Inspector shows the selected Scene’s number, heading/name, location, time, characters and draft status. A continuity summary is omitted because the existing Scene contract has no dedicated continuity summary. No status is inferred from text length.

At 2560 px the Shell has a 216 px nav, main workspace and 344 px Inspector; the Script tree is inside the main workspace. At 1920 px the nav starts as a 64 px rail, Inspector starts closed and opens as an overlay without shrinking the editor. Escape closes it. Visual smoke artifacts are generated in `test-results/Story-2560.png`, `Script-2560.png`, `Story-1920.png` and `Script-1920.png`.

## Verification and limits

Unit coverage includes schema9 backfill/idempotence, Story revision conflict and restart persistence, format5 round-trip, format4 restore and disabled workflow execution. Existing v6–v8 migration/backup tests and Script CRUD/import/AI regression tests remain active. The Electron smoke suite covers Story/Script context round-trip, Inspector and responsive layouts. Scene content remains a form editor; rich screenplay pagination and a distinct director-note model are outside this step. The production Tool/Workflow architecture and permissions are unchanged.
