# 0.8 Creator Shell · Step 08-02

Status: shell implemented on the 0.7.0 renderer; content workspaces remain compatibility mounts.

## Structure and navigation

`App.tsx` still owns the single renderer root and the existing `WorkspaceProvider`. The Project List renders outside `CreatorShell`. Opening a project enters Story; returning to Project List keeps the project loaded so it can be reopened. `CreatorShell` contains `TopBar`, `ProjectNav`, `MainWorkspace`, `ContextInspector`, `TaskDrawer`, `ToastProvider`, and a workspace-level `CreatorErrorBoundary`.

The six primary project destinations are, in order: 故事、剧本、资产、分镜、生成、分镜视频. 项目设置 and 验收与维护 form the secondary section. The TopBar shows project, module, save state, task entry, inspector entry, settings, project switcher, and the existing Simple/Advanced toggle. It is one row and 52 px high. The expanded ProjectNav is 216 px; its 64 px rail retains accessible labels, tooltips, keyboard buttons, and `aria-current`.

## Compatibility mounts

| Creator destination | Existing mount |
| --- | --- |
| 故事 | Read-only current project name, description, genre, format and language; existing rename dialog for name |
| 剧本 | `ScriptPage` |
| 资产 | Tabs mounting `CharactersPage`, `LocationsPage`, `PropsPage` and a disclosed `AssetsPage` |
| 分镜 | `StoryboardPage` with existing batch and shot panels |
| 生成 | `GenerationPage` with Workflow, direct Image/Video and legacy task panels |
| 分镜视频 | `ProductionBoard` compatibility view |
| 项目设置 | `ProviderSettingsPage` and existing provider/credential configuration |
| 验收与维护 | `OperationsPage` for diagnostics, readiness, backup, provenance, About and full task history |

The former `AssetsPage` and `ProductionBoard` also remain reachable through the labelled legacy links on Settings/Maintenance. Existing page actions and IPC continue to work. This step does not relabel all controls inside those pages or build the 08-03 content layout.

## Creator context

`CreatorContextProvider` holds renderer-only module/selection state: optional Scene, Shot, Asset and Candidate IDs plus Inspector and TaskDrawer visibility. The existing workspace module remains the navigation source; legacy module names map to a creator owner. `navigateCreator(module, selection)` validates Scene, Shot and Asset IDs against entities in the current project before accepting them; a missing Shot produces a short notice and clears that selection. The provider remounts when the project changes, so selections do not cross projects. Each project's last creative stage is stored in renderer localStorage and restored when reopened. The Shot selector in the compatibility workspaces demonstrates Storyboard → Generate → Storyboard navigation with the same Shot ID. Candidate validation and automatic selection from every old content row belong to later page work.

## Inspector and responsive layout

The Inspector contract accepts `title`, `objectType`, `content` and optional `footer` actions. The current mount supplies contextual entity information and Shot navigation. At widths of 2200 px and above it occupies a 344 px grid column; at 1920 px it is a fixed right overlay, initially closed, without changing MainWorkspace width or scroll position. It provides a close button, Escape handling, initial close-button focus, focus containment and focus return. MainWorkspace is the principal scroll region with `min-width: 0` and `min-height: 0`. The fixed shell prevents document-level scrolling; Inspector and expanded TaskDrawer scroll independently. At 1920 px the 280 px TaskDrawer overlays the bottom of MainWorkspace. The navigation defaults to the 64 px rail and can be expanded manually.

## Task projection and status

`TaskDrawer` uses the existing read-only `operations.snapshot` IPC and `listWorkflowRuns` command. It projects AITask/QC/production rows and WorkflowRun rows into target/action/status. It does not add a CreatorTask table or alter task transitions. The collapsed summary counts currently loaded task rows and WorkflowRuns; the operations snapshot returns 50 task rows per page, so a project with more than 50 rows may have an incomplete summary. The full task history remains in Maintenance.

`status.ts` is the single new creator-facing mapping for 草稿、待生成、准备就绪、生成中、待审核、已确认、失败、等待用户、不可用. The task-specific projection additionally uses 排队 and 完成; a successful generation result without an official binding remains 待审核. Existing content pages retain their original labels until their redesign.

## Feedback and failures

`ToastProvider` supports success, warning, error and info messages, automatic dismissal after five seconds, manual close and accessible live text. The existing mode switch exercises it. Adoption-specific messages will be wired by later content steps. `CreatorErrorBoundary` catches render errors inside the current workspace, shows a retry action and hides technical details behind a disclosure while logging the full error to the developer console.

## Version and next step

No IPC, preload, main-process, SQLite, backup, package-version or production-model changes were made. Package stays 0.7.0, schema stays 9, and backup format stays 4. Step 08-03 should replace the Story compatibility summary with its planned writing workspace after its persistence boundary is defined, then connect page selections to the shared Inspector and context navigation.
