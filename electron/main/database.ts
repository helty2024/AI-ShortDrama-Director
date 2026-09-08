import { migrateProduction } from './production/migration.js'
import { migrateVideo } from './video/migration.js'
import { migrateVisual } from './visual/migration.js'
import { migrateIntelligence } from './intelligence/migration.js'
import { DatabaseSync } from 'node:sqlite'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import {
  draftInputSchema,
  entitySchema,
  idSchema,
  projectInputSchema,
  projectSchema,
  projectUpdateSchema,
} from '../../src/shared/domain.js'
import type {
  Entity,
  EntityKind,
  Project,
  Workspace,
} from '../../src/shared/domain.js'

export class DomainError extends Error {
  readonly code: 'NOT_FOUND' | 'CONFLICT' | 'FORBIDDEN' | 'INVALID_INPUT'
  constructor(
    code: 'NOT_FOUND' | 'CONFLICT' | 'FORBIDDEN' | 'INVALID_INPUT',
    message: string,
  ) {
    super(message)
    this.code = code
  }
}
export function metadata() {
  const now = new Date().toISOString()
  return { id: randomUUID(), createdAt: now, updatedAt: now, revision: 1 }
}
export function references(entity: Entity): { id: string; kind: EntityKind }[] {
  const refs: { id: string; kind: EntityKind }[] = []
  const add = (kind: EntityKind, id: string | null) => {
    if (id) refs.push({ id, kind })
  }
  if ('previousVersionId' in entity) add(entity.kind, entity.previousVersionId)
  switch (entity.kind) {
    case 'episode':
      add('script', entity.scriptId)
      break
    case 'scene':
      add('episode', entity.episodeId)
      add('location', entity.locationId)
      entity.content.dialogue.forEach((line) =>
        add('character', line.characterId),
      )
      break
    case 'storyboard':
      add('episode', entity.episodeId)
      break
    case 'shot':
      add('storyboard', entity.storyboardId)
      add('scene', entity.sceneId)
      add('asset', entity.approvedKeyframeAssetId)
      add('asset', entity.confirmedVideoAssetId)
      add('location', entity.locationId)
      entity.characterIds.forEach((id) => add('character', id))
      entity.propIds.forEach((id) => add('prop', id))
      entity.assetIds.forEach((id) => add('asset', id))
      break
    case 'character':
    case 'location':
    case 'prop':
      if (entity.kind === 'prop') {
        entity.bible.usedByCharacterIds.forEach((id) => add('character', id))
        entity.bible.sceneIds.forEach((id) => add('scene', id))
      }
      entity.visualReferences.forEach((ref) => add('asset', ref.assetId))
      entity.assetIds.forEach((id) => add('asset', id))
      break
    case 'generationTask':
      add('shot', entity.shotId)
      entity.inputAssetIds.forEach((id) => add('asset', id))
      entity.outputAssetIds.forEach((id) => add('asset', id))
      break
  }
  return refs
}

export class ProjectDatabase {
  private db: DatabaseSync
  constructor(path: string) {
    this.db = new DatabaseSync(path)
    this.db.exec(
      'PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;',
    )
    try {
      this.migrate()
    } catch (error) {
      this.db.close()
      throw error
    }
  }
  private migrate() {
    const row = this.db.prepare('PRAGMA user_version').get()
    const version = Number(row?.user_version ?? 0)
    if (version > 5) throw new Error('数据库版本高于当前应用支持版本')
    if (version === 0)
      this.transaction(() => {
        this.db.exec(`
        CREATE TABLE projects (id TEXT PRIMARY KEY, data TEXT NOT NULL CHECK(json_valid(data)));
        CREATE TABLE entities (
          id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          kind TEXT NOT NULL, data TEXT NOT NULL CHECK(json_valid(data)), UNIQUE(project_id, id)
        );
        CREATE INDEX entities_project_kind ON entities(project_id, kind);
        CREATE TABLE entity_refs (
          project_id TEXT NOT NULL, source_id TEXT NOT NULL, target_id TEXT NOT NULL,
          PRIMARY KEY(source_id, target_id),
          FOREIGN KEY(project_id, source_id) REFERENCES entities(project_id, id) ON DELETE CASCADE,
          FOREIGN KEY(project_id, target_id) REFERENCES entities(project_id, id) ON DELETE CASCADE
        );
        CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        PRAGMA user_version = 1;
      `)
      })
    if (version < 2) this.transaction(() => migrateIntelligence(this.db))
    if (version < 3) this.transaction(() => migrateVisual(this.db))
    if (version < 4) this.transaction(() => migrateVideo(this.db))
    if (version < 5) this.transaction(() => migrateProduction(this.db))
  }
  transaction<T>(operation: () => T): T {
    if (this.db.isTransaction) return operation()
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const value = operation()
      this.db.exec('COMMIT')
      return value
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }
  get connection() {
    return this.db
  }
  close() {
    this.db.close()
  }
  list(): Project[] {
    return this.db
      .prepare('SELECT data FROM projects')
      .all()
      .map((row) => projectSchema.parse(JSON.parse(String(row.data))))
      .sort(
        (a, b) =>
          (b.lastOpenedAt ?? b.createdAt).localeCompare(
            a.lastOpenedAt ?? a.createdAt,
          ) || a.id.localeCompare(b.id),
      )
  }
  get(input: unknown): Project {
    const id = idSchema.parse(input)
    const row = this.db
      .prepare('SELECT data FROM projects WHERE id = ?')
      .get(id)
    if (!row) throw new DomainError('NOT_FOUND', '项目不存在或已被删除')
    return projectSchema.parse(JSON.parse(String(row.data)))
  }
  create(input: unknown): Project {
    const project = projectSchema.parse({
      ...projectInputSchema.parse(input),
      ...metadata(),
      lastOpenedAt: null,
    })
    this.db
      .prepare('INSERT INTO projects(id, data) VALUES (?, ?)')
      .run(project.id, JSON.stringify(project))
    return project
  }
  update(input: unknown): Project {
    const { id, changes, expectedRevision } = projectUpdateSchema.parse(input)
    return this.transaction(() => {
      const old = this.get(id)
      if (old.revision !== expectedRevision)
        throw new DomainError('CONFLICT', '项目已更新，请重新打开后重试')
      const project = projectSchema.parse({
        ...old,
        ...changes,
        revision: old.revision + 1,
        updatedAt: new Date().toISOString(),
      })
      this.db
        .prepare('UPDATE projects SET data = ? WHERE id = ?')
        .run(JSON.stringify(project), id)
      return project
    })
  }
  open(id: unknown): Project {
    return this.transaction(() => {
      const project = this.get(id)
      project.lastOpenedAt = new Date().toISOString()
      this.db
        .prepare('UPDATE projects SET data = ? WHERE id = ?')
        .run(JSON.stringify(project), project.id)
      return project
    })
  }
  delete(id: unknown): null {
    this.get(id)
    this.db.prepare('DELETE FROM projects WHERE id = ?').run(idSchema.parse(id))
    return null
  }
  workspace(id: unknown): Workspace {
    const project = this.get(id)
    const entities = this.db
      .prepare('SELECT data FROM entities WHERE project_id = ? ORDER BY rowid')
      .all(project.id)
      .map((row) => entitySchema.parse(JSON.parse(String(row.data))))
    return { project, entities }
  }
  insertEntities(projectId: string, values: unknown[]): Entity[] {
    this.get(projectId)
    const entities = z.array(entitySchema).parse(values)
    return this.transaction(() => {
      for (const entity of entities) {
        if (entity.projectId !== projectId)
          throw new DomainError('CONFLICT', '不能跨项目写入数据')
        this.db
          .prepare(
            'INSERT INTO entities(id, project_id, kind, data) VALUES (?, ?, ?, ?)',
          )
          .run(entity.id, projectId, entity.kind, JSON.stringify(entity))
      }
      for (const entity of entities) {
        for (const ref of references(entity)) {
          const target = this.db
            .prepare(
              'SELECT kind FROM entities WHERE project_id = ? AND id = ?',
            )
            .get(projectId, ref.id)
          if (ref.id === entity.id || target?.kind !== ref.kind)
            throw new DomainError(
              'CONFLICT',
              '关联对象不存在、类型不匹配或不属于当前项目',
            )
          this.db
            .prepare('INSERT OR IGNORE INTO entity_refs VALUES (?, ?, ?)')
            .run(projectId, entity.id, ref.id)
        }
        if (entity.kind === 'shot') {
          const records = this.workspace(projectId).entities
          const board = records.find((item) => item.id === entity.storyboardId)
          const scene = records.find((item) => item.id === entity.sceneId)
          if (
            board?.kind !== 'storyboard' ||
            scene?.kind !== 'scene' ||
            board.episodeId !== scene.episodeId
          )
            throw new DomainError('CONFLICT', '镜头的分镜和场次必须属于同一集')
        }
      }
      return entities
    })
  }
  createDraft(input: unknown): Entity {
    const draft = draftInputSchema.parse(input)
    const base = {
      ...metadata(),
      projectId: draft.projectId,
      name: draft.name,
      description: '',
      kind: draft.kind,
    }
    const parent = () => {
      if (!draft.parentId) throw new DomainError('CONFLICT', '请先选择父级对象')
      return draft.parentId
    }
    let value: unknown
    switch (draft.kind) {
      case 'script':
        value = { ...base, content: '', previousVersionId: null }
        break
      case 'episode':
        value = {
          ...base,
          scriptId: parent(),
          order: this.workspace(draft.projectId).entities.filter(
            (e) => e.kind === 'episode' && e.scriptId === draft.parentId,
          ).length,
        }
        break
      case 'scene':
        value = {
          ...base,
          episodeId: parent(),
          locationId: null,
          order: this.workspace(draft.projectId).entities.filter(
            (e) => e.kind === 'scene' && e.episodeId === draft.parentId,
          ).length,
        }
        break
      case 'character':
        value = { ...base, appearance: '', assetIds: [] }
        break
      case 'location':
      case 'prop':
        value = { ...base, assetIds: [] }
        break
      case 'storyboard':
        value = { ...base, episodeId: parent(), previousVersionId: null }
        break
      case 'shot':
        value = {
          ...base,
          storyboardId: parent(),
          sceneId: draft.sceneId,
          order: this.workspace(draft.projectId).entities.filter(
            (e) => e.kind === 'shot' && e.storyboardId === draft.parentId,
          ).length,
          durationSeconds: 5,
          characterIds: [],
          locationId: null,
          propIds: [],
          assetIds: [],
          imagePrompt: '',
          videoPrompt: '',
          previousVersionId: null,
        }
        break
      case 'asset':
        value = {
          ...base,
          mediaType: 'image',
          uri: null,
          status: 'placeholder',
          source: null,
          previousVersionId: null,
        }
        break
      case 'generationTask':
        value = {
          ...base,
          taskType: 'image',
          status: 'draft',
          shotId: draft.parentId ?? null,
          source: null,
          inputAssetIds: [],
          outputAssetIds: [],
          providerTaskId: null,
          error: null,
        }
        break
    }
    return this.insertEntities(draft.projectId, [value])[0]!
  }
  seed(build: (projectId: string) => unknown[]): Project {
    return this.transaction(() => {
      const existing = this.db
        .prepare("SELECT value FROM settings WHERE key = 'seed-project'")
        .get()
      if (existing && this.list().some((p) => p.id === existing.value))
        return this.get(existing.value)
      const project = this.create({
        name: '雨夜来信 · 示例短剧',
        description:
          '一封旧信让三个人在雨夜车站重逢。开发示例，不包含真实生成媒体。',
        genre: '悬疑',
        aspectRatio: '9:16',
        language: 'zh-CN',
      })
      this.insertEntities(project.id, build(project.id))
      this.db
        .prepare("INSERT OR REPLACE INTO settings VALUES ('seed-project', ?)")
        .run(project.id)
      return project
    })
  }
}
