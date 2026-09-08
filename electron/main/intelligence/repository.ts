import { z } from 'zod'
import {
  ProjectDatabase,
  DomainError,
  metadata,
  references,
} from '../database.js'
import { entitySchema } from '../../../src/shared/domain.js'
import type { Entity, Scene } from '../../../src/shared/domain.js'
import {
  aiTaskSchema,
  intelligenceDraftSchema,
  importPreviewSchema,
  productionElementSchema,
  sceneContentSchema,
  characterBibleSchema,
  locationBibleSchema,
  propBibleSchema,
  parsedScriptSchema,
} from '../../../src/shared/intelligence.js'
import type {
  AITask,
  IntelligenceDraft,
  ImportPreview,
  ProductionElement,
  IntelligenceSnapshot,
  DraftPayload,
  ParsedScript,
} from '../../../src/shared/intelligence.js'

type Table =
  'ai_tasks' | 'intelligence_drafts' | 'import_previews' | 'production_elements'
export class IntelligenceRepository {
  readonly database: ProjectDatabase
  constructor(database: ProjectDatabase) {
    this.database = database
  }
  list<T>(projectId: string, table: Table, schema: z.ZodType<T>): T[] {
    this.database.get(projectId)
    return this.database.connection
      .prepare(`SELECT data FROM ${table} WHERE project_id = ? ORDER BY rowid`)
      .all(projectId)
      .map((row) => schema.parse(JSON.parse(String(row.data))))
  }
  private write(
    table: Table,
    item: AITask | IntelligenceDraft | ImportPreview | ProductionElement,
  ) {
    this.database.get(item.projectId)
    if (table === 'intelligence_drafts' && 'sceneId' in item) {
      this.database.connection
        .prepare(
          'INSERT INTO intelligence_drafts(id, project_id, scene_id, data) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET data=excluded.data',
        )
        .run(item.id, item.projectId, item.sceneId, JSON.stringify(item))
    } else
      this.database.connection
        .prepare(
          `INSERT INTO ${table}(id, project_id, data) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET data=excluded.data`,
        )
        .run(item.id, item.projectId, JSON.stringify(item))
  }
  putTask(item: AITask) {
    this.write('ai_tasks', aiTaskSchema.parse(item))
    return item
  }
  putDraft(item: IntelligenceDraft) {
    this.write('intelligence_drafts', intelligenceDraftSchema.parse(item))
    return item
  }
  putImport(item: ImportPreview) {
    this.write('import_previews', importPreviewSchema.parse(item))
    return item
  }
  putProduction(item: ProductionElement) {
    this.write('production_elements', productionElementSchema.parse(item))
    return item
  }
  snapshot(projectId: string, provider: string): IntelligenceSnapshot {
    return {
      tasks: this.list(projectId, 'ai_tasks', aiTaskSchema),
      drafts: this.list(
        projectId,
        'intelligence_drafts',
        intelligenceDraftSchema,
      ),
      imports: this.list(projectId, 'import_previews', importPreviewSchema),
      production: this.list(
        projectId,
        'production_elements',
        productionElementSchema,
      ),
      provider,
    }
  }
  entity(projectId: string, id: string): Entity {
    const result = this.database
      .workspace(projectId)
      .entities.find((item) => item.id === id)
    if (!result)
      throw new DomainError('NOT_FOUND', '对象不存在或不属于当前项目')
    return result
  }
  task(projectId: string, id: string) {
    const row = this.database.connection
      .prepare('SELECT data FROM ai_tasks WHERE project_id=? AND id=?')
      .get(projectId, id)
    if (!row) throw new DomainError('NOT_FOUND', '任务不存在')
    return aiTaskSchema.parse(JSON.parse(String(row.data)))
  }
  draft(projectId: string, id: string) {
    const draft = this.list(
      projectId,
      'intelligence_drafts',
      intelligenceDraftSchema,
    ).find((item) => item.id === id)
    if (!draft) throw new DomainError('NOT_FOUND', '草稿不存在')
    return draft
  }
  checkRevision(actual: number, expected: number) {
    if (actual !== expected)
      throw new DomainError(
        'CONFLICT',
        '数据已更新，请重新载入后重试；本地修改仍保留',
      )
  }
  updateEntity(
    projectId: string,
    id: string,
    expectedRevision: number,
    changes: Record<string, unknown>,
  ): Entity {
    return this.database.transaction(() => {
      const old = this.entity(projectId, id)
      this.checkRevision(old.revision, expectedRevision)
      const value = entitySchema.parse({
        ...old,
        ...changes,
        id: old.id,
        projectId: old.projectId,
        kind: old.kind,
        createdAt: old.createdAt,
        updatedAt: new Date().toISOString(),
        revision: old.revision + 1,
      })
      this.database.connection
        .prepare('UPDATE entities SET data = ? WHERE id = ?')
        .run(JSON.stringify(value), id)
      this.rebuildReferences(projectId)
      return value
    })
  }
  private rebuildReferences(projectId: string) {
    const entities = this.database.workspace(projectId).entities
    const byId = new Map(entities.map((e) => [e.id, e]))
    this.database.connection
      .prepare('DELETE FROM entity_refs WHERE project_id = ?')
      .run(projectId)
    for (const entity of entities) {
      for (const ref of references(entity)) {
        if (ref.id === entity.id || byId.get(ref.id)?.kind !== ref.kind)
          throw new DomainError('CONFLICT', '关联对象必须存在且属于同一项目')
        this.database.connection
          .prepare('INSERT OR IGNORE INTO entity_refs VALUES (?, ?, ?)')
          .run(projectId, entity.id, ref.id)
      }
      if (entity.kind === 'shot') {
        const scene = byId.get(entity.sceneId),
          board = byId.get(entity.storyboardId)
        if (
          scene?.kind !== 'scene' ||
          board?.kind !== 'storyboard' ||
          scene.episodeId !== board.episodeId
        )
          throw new DomainError('CONFLICT', '镜头场次与分镜表必须属于同一集')
      }
    }
  }
  saveScene(projectId: string, id: string, revision: number, input: unknown) {
    const scene = this.entity(projectId, id)
    if (scene.kind !== 'scene')
      throw new DomainError('CONFLICT', '只能编辑 Scene')
    const content = sceneContentSchema.parse(input)
    return this.updateEntity(projectId, id, revision, {
      content,
      name: (content.heading || scene.name).slice(0, 120),
    })
  }
  renameEpisode(projectId: string, id: string, revision: number, name: string) {
    if (this.entity(projectId, id).kind !== 'episode')
      throw new DomainError('CONFLICT', '只能重命名 Episode')
    return this.updateEntity(projectId, id, revision, { name })
  }
  reorder(projectId: string, id: string, revision: number, sceneIds: string[]) {
    return this.database.transaction(() => {
      const episode = this.entity(projectId, id)
      if (episode.kind !== 'episode')
        throw new DomainError('CONFLICT', '请选择分集')
      this.checkRevision(episode.revision, revision)
      const scenes = this.database
        .workspace(projectId)
        .entities.filter((e) => e.kind === 'scene' && e.episodeId === id)
      if (
        new Set(sceneIds).size !== scenes.length ||
        sceneIds.length !== scenes.length ||
        scenes.some((s) => !sceneIds.includes(s.id))
      )
        throw new DomainError('CONFLICT', '排序必须包含本集全部场次且不能重复')
      for (const scene of scenes)
        this.updateEntity(projectId, scene.id, scene.revision, {
          order: sceneIds.indexOf(scene.id),
        })
      return this.updateEntity(projectId, id, revision, {})
    })
  }
  deleteTree(projectId: string, id: string, revision: number) {
    return this.database.transaction(() => {
      const root = this.entity(projectId, id)
      if (root.kind !== 'episode' && root.kind !== 'scene')
        throw new DomainError('FORBIDDEN', '只能删除分集或场次')
      this.checkRevision(root.revision, revision)
      const entities = this.database.workspace(projectId).entities
      const removed = new Set([id])
      for (const entity of entities)
        if (
          (entity.kind === 'scene' || entity.kind === 'storyboard') &&
          entity.episodeId === id
        )
          removed.add(entity.id)
      for (const entity of entities)
        if (
          entity.kind === 'shot' &&
          (removed.has(entity.sceneId) || removed.has(entity.storyboardId))
        )
          removed.add(entity.id)
      for (const entity of entities) {
        if (removed.has(entity.id)) continue
        let value: Entity = entity
        if (
          entity.kind === 'prop' &&
          entity.bible.sceneIds.some((sceneId) => removed.has(sceneId))
        )
          value = {
            ...entity,
            bible: {
              ...entity.bible,
              sceneIds: entity.bible.sceneIds.filter(
                (sceneId) => !removed.has(sceneId),
              ),
            },
          }
        if (
          entity.kind === 'generationTask' &&
          entity.shotId &&
          removed.has(entity.shotId)
        )
          value = { ...entity, shotId: null }
        if (
          'previousVersionId' in entity &&
          entity.previousVersionId &&
          removed.has(entity.previousVersionId)
        )
          value = { ...entity, previousVersionId: null }
        if (value !== entity)
          this.database.connection
            .prepare('UPDATE entities SET data = ? WHERE id = ?')
            .run(
              JSON.stringify({
                ...value,
                revision: value.revision + 1,
                updatedAt: new Date().toISOString(),
              }),
              value.id,
            )
      }
      const removedDrafts = new Set(
        this.list(projectId, 'intelligence_drafts', intelligenceDraftSchema)
          .filter((draft) => removed.has(draft.sceneId))
          .map((draft) => draft.id),
      )
      for (const element of this.list(
        projectId,
        'production_elements',
        productionElementSchema,
      )) {
        if (element.sceneIds.some((sceneId) => removed.has(sceneId)))
          this.putProduction({
            ...element,
            sceneIds: element.sceneIds.filter(
              (sceneId) => !removed.has(sceneId),
            ),
            draftIds: element.draftIds.filter(
              (draftId) => !removedDrafts.has(draftId),
            ),
            revision: element.revision + 1,
            updatedAt: new Date().toISOString(),
          })
      }
      for (const entityId of removed)
        this.database.connection
          .prepare('DELETE FROM entities WHERE id = ? AND project_id = ?')
          .run(entityId, projectId)
      this.rebuildReferences(projectId)
      return null
    })
  }
  saveBible(
    projectId: string,
    id: string,
    revision: number,
    name: string,
    description: string,
    assetIds: string[],
    bible: unknown,
  ) {
    const entity = this.entity(projectId, id)
    const schema =
      entity.kind === 'character'
        ? characterBibleSchema
        : entity.kind === 'location'
          ? locationBibleSchema
          : entity.kind === 'prop'
            ? propBibleSchema
            : null
    if (!schema)
      throw new DomainError('CONFLICT', '只能编辑角色、场景或道具 Bible')
    return this.updateEntity(projectId, id, revision, {
      name,
      description,
      assetIds,
      bible: schema.parse(bible),
    })
  }
  confirmImport(
    projectId: string,
    id: string,
    revision: number,
    input: ParsedScript,
  ) {
    return this.database.transaction(() => {
      const preview = this.list(
        projectId,
        'import_previews',
        importPreviewSchema,
      ).find((p) => p.id === id)
      if (!preview) throw new DomainError('NOT_FOUND', '导入预览不存在')
      if (preview.confirmedScriptId)
        return this.entity(projectId, preview.confirmedScriptId)
      this.checkRevision(preview.revision, revision)
      const parsed = parsedScriptSchema.parse(input)
      const base = (name: string) => ({
        ...metadata(),
        projectId,
        name,
        description: '',
      })
      const script = entitySchema.parse({
        ...base(preview.name),
        kind: 'script',
        content: preview.rawText,
        previousVersionId: null,
      })
      const values: Entity[] = [script]
      parsed.episodes.forEach((episode, index) => {
        const item = entitySchema.parse({
          ...base(episode.name),
          kind: 'episode',
          scriptId: script.id,
          order: index,
        })
        values.push(item)
        episode.scenes.forEach((content, order) =>
          values.push(
            entitySchema.parse({
              ...base((content.heading || '未命名场次').slice(0, 120)),
              kind: 'scene',
              episodeId: item.id,
              order,
              locationId: null,
              content,
            }),
          ),
        )
      })
      this.database.insertEntities(projectId, values)
      this.putImport({
        ...preview,
        parsed,
        confirmedScriptId: script.id,
        revision: preview.revision + 1,
        updatedAt: new Date().toISOString(),
      })
      return script
    })
  }
  selectedScenes(projectId: string, targetId: string): Scene[] {
    const target = this.entity(projectId, targetId)
    const entities = this.database.workspace(projectId).entities
    const episodeIds =
      target.kind === 'script'
        ? entities
            .filter((e) => e.kind === 'episode' && e.scriptId === targetId)
            .map((e) => e.id)
        : [targetId]
    const scenes = entities
      .filter(
        (e): e is Scene =>
          e.kind === 'scene' &&
          (e.id === targetId || episodeIds.includes(e.episodeId)),
      )
      .sort((a, b) => a.order - b.order)
    if (!scenes.length)
      throw new DomainError('CONFLICT', '请选择包含场次的剧本、分集或场次')
    if (scenes.length > 100)
      throw new DomainError('CONFLICT', '单次最多分析 100 个场次，请分集处理')
    return scenes
  }
  editDraft(
    projectId: string,
    id: string,
    revision: number,
    payload: DraftPayload | null,
  ) {
    return this.database.transaction(() => {
      const draft = this.draft(projectId, id)
      this.checkRevision(draft.revision, revision)
      if (draft.status !== 'pending')
        throw new DomainError('CONFLICT', '已处理的草稿不能再次修改')
      if (payload && payload.type !== draft.payload.type)
        throw new DomainError('CONFLICT', '不能改变草稿类型')
      return this.putDraft({
        ...draft,
        payload: payload ?? draft.payload,
        status: payload ? 'pending' : 'ignored',
        revision: draft.revision + 1,
        updatedAt: new Date().toISOString(),
      })
    })
  }
}
