# Figma Brief — 0.8 Creator UI

Status: handoff from Creator UI Baseline v1

Fidelity: low to mid; structure and interaction before visual effects

## 1. Design objective

Design AI ShortDrama Director as a professional Windows desktop workspace for creating short dramas. The interface must foreground the creator's current Story, Scene, Asset or Shot and hide production infrastructure until requested.

Primary journey, fixed order:

**故事 → 剧本 → 资产 → 分镜 → 生成 → 分镜视频**

The first pass must prove information hierarchy, density, selection behavior, progressive disclosure and states. Do not spend the first pass on decorative branding, complex motion or high-fidelity image art.

## 2. Required frames

Create these seven named primary frames at **2560×1440**:

1. `01 Project Shell`
2. `02 Story`
3. `03 Script`
4. `04 Assets`
5. `05 Storyboard`
6. `06 Generate`
7. `07 Shot Videos`

Create or demonstrate a **1920×1080** responsive variant for the shell and at least Script, Storyboard, Generate and Shot Videos. The responsive check may be a separate page/section of variants; it must show the actual collapse rules rather than scale the 2560 frame.

## 3. Shared shell specification

Use one reusable shell across frames 02–07:

- TopBar: 48–56 px.
- ProjectNav: 200–220 px expanded, optional 56–64 px icon rail.
- ContextInspector: 320–360 px expanded and collapsible.
- TaskDrawer: 32–40 px collapsed, 260–320 px expanded.
- Main Workspace: flexible remaining width, with page title inside the workspace.

ProjectNav:

- Top: back to Project List, project name.
- Main: 故事、剧本、资产、分镜、生成、分镜视频.
- Bottom, reduced emphasis: 项目设置、验收与维护.

TopBar:

- Project name
- Current module
- Save state
- Global task status entrance
- Settings
- Required Windows controls

Do not place Tool, Provider, Task, Approval, Routing or Provenance in the primary navigation.

## 4. Shared visual direction

- Dark neutral background, never pure black.
- Work surfaces one step lighter than the application background.
- One primary accent color.
- Status colors used only for status meaning.
- Fine borders, tonal separation and restrained shadows.
- No neon, glassmorphism, glowing cards or large gradient fields.
- Font stack represented with Microsoft YaHei UI / Segoe UI / system sans-serif.
- Page title 20–22 px; section 15–16 px; body 13–14 px; metadata 12 px.
- Spacing uses 4/8 px base and 8/12/16/24 px common steps.
- Control radius 6–8 px; panel radius 8–10 px.
- Dense professional cards; avoid 16–24 px decorative radii and 32 px card padding.
- One primary CTA per local region.

Use neutral thumbnails/placeholders during low/mid fidelity. Do not use giant illustration empty states.

## 5. Shared component inventory

Define components or variants for:

- ProjectNav
- TopBar
- ContextInspector
- TaskDrawer
- StatusBadge
- AssetCard
- AssetCandidateCard
- ShotCard
- ShotSequenceStrip
- GeneratePanel
- GenerationDescriptionEditor
- AdvancedGenerationPanel
- CandidateCompare
- VideoPreview
- ReviewActions
- SourceDetails
- EmptyState
- ErrorBanner
- ConfirmationDialog

Only define states used by the seven frames. This handoff does not request a universal design system.

## 6. Frame 01 — Project Shell

Purpose: establish global structure without binding it to one feature.

Show:

- Expanded ProjectNav with the six stages and lower Settings/Maintenance group.
- Compact TopBar with project name, current module, save state and task entrance.
- Main Workspace with a representative header and content density guides.
- ContextInspector expanded with selected-object placeholder content.
- TaskDrawer collapsed and one expanded variant.

Prove:

- Central workspace remains wide at 2560.
- Inspector can collapse.
- Secondary destinations are visibly separate from the creator journey.
- Task Drawer does not become a full-time dashboard.

## 7. Frame 02 — Story

Purpose: creative brief workspace.

Show:

- Story name and one-line concept near the top.
- A large story synopsis area.
- Compact fields/sections for genre, style, world and creative requirements.
- Save state from TopBar, without a duplicate large save banner.
- Optional AI assistance placement as secondary, disabled or reserved; do not imply it is implemented.
- Story-oriented ContextInspector.

Avoid Tool, Model, Prompt or task records.

Primary action: edit/begin story. Empty state copy: “先写一句话概念，建立这个短剧的创作方向。”

## 8. Frame 03 — Script

Purpose: make structured Scene editing the visual center.

Show:

- Left Episode/Scene structure with 8–12 compact Scene rows.
- Center editor with heading, location/time, characters, action, dialogue, narration and director notes.
- Right Scene Inspector with current scene, related characters and continuity summary.
- A compact entrance for import/intelligent breakdown, not Provider settings.
- Selected Scene and saved/dirty examples.

The editor receives the most width. AI analysis cannot crowd the writing surface. Use current structured fields rather than a single Markdown document.

## 9. Frame 04 — Assets

Purpose: unify Character, Location and Prop bibles with their media versions.

Show:

- Tabs: 角色 / 场景 / 道具.
- Search and compact filters.
- Dense card grid with several visible AssetCards.
- Each card: thumbnail, name, type, current main version, StatusBadge.
- Selected Character card and Inspector with Bible summary, main reference, candidates and generation entry.
- AssetCandidateCard and an inline/current-context “设为主参考” action.

Do not create sections by source Tool. Imported, Packy and ComfyUI results are version/source attributes only.

## 10. Frame 05 — Storyboard

Purpose: compact multi-Shot direction workspace.

Show:

- Episode/Scene scope controls.
- Compact Shot Board with enough cards to prove density.
- Each ShotCard: number, keyframe, duration, short description, characters, framing/movement and status.
- Selected Shot and ContextInspector with complete Shot parameters and references.
- An obvious contextual “生成关键帧” or “前往生成” action.
- Multi-select/reorder affordance at secondary priority.

At 2560×1440, several cards must be visible at once. Do not render one huge card per row.

## 11. Frame 06 — Generate

Purpose: Production Center centered on the selected Shot.

Show:

- Left Shot Queue with status groups or filters.
- Center GeneratePanel for Shot 08.
- GenerationDescriptionEditor as the default creative input.
- “生成方式：自动” as a compact line.
- One primary 生成 button.
- Collapsed AdvancedGenerationPanel.
- Right Generate Inspector with input readiness and source summary.
- CandidateCompare in a Waiting Review variant.
- ConfirmationDialog variant for a paid cloud Tool.

The paid confirmation displays Tool, Model, count, estimated cost/currency and cloud upload statement. It must not display Approval or Reservation terminology.

Create a local ComfyUI confirmation variant that says 本地生成 and 预计 API 费用：0.

## 12. Frame 07 — Shot Videos

Purpose: review and order confirmed/candidate Shot video, without implying a timeline editor.

Show:

- Ordered Shot list on top or left.
- Center VideoPreview.
- Right inspector with current official video, Candidate A/B, review actions and source entry.
- Bottom ShotSequenceStrip with several shots and missing/completed states.
- Primary action “设为当前镜头视频” for an approved candidate.

Do not show tracks, waveform, trim handles, subtitles, BGM, audio lanes or export-as-final-film controls.

## 13. Required state coverage

Across the seven main frames, show at least these states:

| State | Required example |
| --- | --- |
| Normal | Script editing or populated Asset/Storyboard workspace |
| Empty | Story, selected Asset tab or Storyboard with one clear next action |
| Generating | Generate workspace plus collapsed TaskDrawer status |
| Waiting Review | Image or video candidate beside the current official version |
| Error | User-facing Tool/runtime error with optional technical-details disclosure |

Suggested distribution:

- Normal: Frames 02–05.
- Empty: alternate Frame 04 or 05 state.
- Generating: Frame 06 variant.
- Waiting Review: Frame 06 and/or 07 variant.
- Error: Frame 06 variant showing “本地 ComfyUI 当前离线” and a link to Settings.

Error state must not lead with `ECONNREFUSED`, raw JSON or stack traces.

## 14. Status language

Use only these creator-facing statuses in the mockups:

- 草稿
- 待生成
- 准备就绪
- 生成中
- 待审核
- 已确认
- 失败
- 等待用户
- 不可用

Do not mix queued, running, pending, candidate, approved, adopted or waiting-user into primary UI. Exact internal states may appear only in a technical-details annotation.

## 15. Review and source pattern

Review pattern:

```text
Current official version | Candidate A | Candidate B
                         [批准] [拒绝]
                         [设为主参考 / 设为当前镜头视频]
```

SourceDetails first level:

- Generation method
- Tool
- Model
- Generated time
- Cost
- Workflow summary

Second level “技术详情” may show record IDs, Tool version and Prompt snapshot. Keep this collapsed in primary frames.

## 16. 1920×1080 validation

Validate these specific adaptations:

- ContextInspector defaults collapsed or opens as an overlay.
- ProjectNav shrinks or becomes an icon rail.
- Main editor/board retains its type and control size.
- TaskDrawer expands over content instead of permanently consuming height.
- Lower-priority toolbar actions move into overflow.
- Script center editor stays wider than the Scene tree.
- Storyboard still displays multiple Shot cards.
- Generate still keeps Shot Queue and central generation action usable; only one side panel stays open at a time.
- Shot Videos keeps the player usable and moves list/inspector into collapsible regions if necessary.

Do not satisfy 1920 by applying a global scale transform.

## 17. Interaction annotations required in Figma

Annotate these transitions:

1. Select Shot 08 in Storyboard → Generate opens with Shot 08.
2. Generate result → compare/review/adopt without leaving the workspace.
3. Generate → View Storyboard returns to Shot 08.
4. Select Asset → Inspector opens; Generate preserves Asset context.
5. Candidate → Source → Technical Details progressive disclosure.
6. Global task status → TaskDrawer expanded → select task → return to creative target.
7. Settings/Maintenance → return to preserved creative stage.

Prototype wiring may be minimal, but arrows/notes must remove ambiguity about context preservation.

## 18. Boundaries

- No Infinite Canvas main frame. Canvas is a future ViewExtension only.
- No Blender main frame. Blender is a future ToolAdapter invoked from Storyboard/Generate.
- No final editing timeline.
- No Provider dashboard in primary flow.
- No new business feature claims.
- No changes to the released Tool, Capability, Routing, Broker, task, provenance, approval, reservation, asset-version or workflow semantics.

## 19. Acceptance checklist

- Seven required 2560×1440 frames are present and named exactly.
- 1920×1080 adaptation is demonstrated for the shell and four complex pages.
- Primary navigation has exactly six production stages in the frozen order.
- The shell hierarchy is consistent across project frames.
- Script editor, Shot Board and Generate workspace receive the dominant visual area.
- Assets show source-neutral cards and contextual candidates.
- Simple generation is the default and advanced controls are collapsed.
- Candidate review and adoption are visible in context.
- Normal, Empty, Generating, Waiting Review and Error are all represented.
- Settings and Maintenance are secondary.
- TaskDrawer is collapsed by default.
- Status labels use the frozen vocabulary.
- No screen implies a node editor, plugin marketplace, final timeline, Blender page or Canvas scheduler.
