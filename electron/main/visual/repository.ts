import { randomUUID } from 'node:crypto'
import { metadata, DomainError } from '../database.js'
import { IntelligenceRepository } from '../intelligence/repository.js'
import { MediaStorage } from './storage.js'
import type { StoredImage } from './storage.js'
import {
  assetVersionSchema,
  providerSettingsSchema,
  defaultProviderSettings,
  workflowTemplateSchema,
} from '../../../src/shared/visual.js'
import type {
  AssetVersion,
  ProviderSettings,
  VisualReference,
  ImagePromptPackage,
} from '../../../src/shared/visual.js'
import { builtinTemplates } from './workflows.js'
import { validateComfyUrl } from './providers.js'
import {
  compileCharacterPrompt,
  compileLocationPrompt,
  compilePropPrompt,
  compileShotKeyframePrompt,
} from './prompt-compiler.js'
export class VisualRepository {
  readonly repo: IntelligenceRepository
  readonly storage: MediaStorage
  constructor(repo: IntelligenceRepository, storage: MediaStorage) {
    this.repo = repo
    this.storage = storage
  }
  versions(projectId: string) {
    this.repo.database.get(projectId)
    return this.repo.database.connection
      .prepare(
        'SELECT data FROM asset_versions WHERE project_id=? ORDER BY version_number',
      )
      .all(projectId)
      .map((row) => assetVersionSchema.parse(JSON.parse(String(row.data))))
  }
  version(projectId: string, id: string) {
    const item = this.versions(projectId).find((v) => v.id === id)
    if (!item) throw new DomainError('NOT_FOUND', '素材版本不存在')
    return item
  }
  asset(projectId: string, id: string) {
    const entity = this.repo.entity(projectId, id)
    if (entity.kind !== 'asset') throw new DomainError('CONFLICT', '请选择素材')
    return entity
  }
  settings(projectId: string): ProviderSettings {
    this.repo.database.get(projectId)
    const row = this.repo.database.connection
      .prepare('SELECT data FROM visual_settings WHERE project_id=?')
      .get(projectId)
    return row
      ? providerSettingsSchema.parse(JSON.parse(String(row.data)))
      : defaultProviderSettings
  }
  saveSettings(projectId: string, input: ProviderSettings) {
    const settings = providerSettingsSchema.parse(input)
    validateComfyUrl(settings.baseUrl)
    if (!this.templates(projectId).some((t) => t.id === settings.templateId))
      throw new DomainError('CONFLICT', '请选择工作流模板')
    this.repo.database.connection
      .prepare(
        'INSERT INTO visual_settings VALUES (?,?) ON CONFLICT(project_id) DO UPDATE SET data=excluded.data',
      )
      .run(projectId, JSON.stringify(settings))
    return null
  }
  templates(projectId: string) {
    this.repo.database.get(projectId)
    const rows = this.repo.database.connection
      .prepare('SELECT data FROM workflow_templates WHERE project_id=?')
      .all(projectId)
      .map((r) => workflowTemplateSchema.parse(JSON.parse(String(r.data))))
    return [
      ...builtinTemplates.filter((t) => !rows.some((r) => r.id === t.id)),
      ...rows,
    ]
  }
  importWorkflow(projectId: string, name: string, raw: unknown) {
    this.repo.database.get(projectId)
    const item = workflowTemplateSchema.parse({
      id: 'custom-' + randomUUID(),
      name: name.slice(0, 120),
      workflow: raw,
    })
    this.repo.database.connection
      .prepare('INSERT INTO workflow_templates VALUES (?,?,?)')
      .run(projectId, item.id, JSON.stringify(item))
    return item.id
  }
  snapshot(projectId: string) {
    return {
      versions: this.versions(projectId),
      settings: this.settings(projectId),
      templates: this.templates(projectId),
    }
  }
  compile(
    projectId: string,
    targetId: string,
    previousShot: boolean,
  ): ImagePromptPackage {
    const target = this.repo.entity(projectId, targetId),
      style = this.settings(projectId).style
    switch (target.kind) {
      case 'character':
        return compileCharacterPrompt(target, style)
      case 'location':
        return compileLocationPrompt(target, style)
      case 'prop':
        return compilePropPrompt(target, style)
      case 'shot':
        return compileShotKeyframePrompt(
          target,
          this.repo.database.workspace(projectId).entities,
          style,
          previousShot,
        )
      default:
        throw new DomainError('CONFLICT', '只支持 Bible 或 Shot 生图')
    }
  }
  commitVersion(
    projectId: string,
    assetId: string,
    stored: StoredImage,
    source: Pick<
      AssetVersion,
      | 'sourceType'
      | 'provider'
      | 'model'
      | 'prompt'
      | 'negativePrompt'
      | 'generationTaskId'
      | 'sourceAssetIds'
      | 'metadata'
    >,
  ) {
    this.asset(projectId, assetId)
    for (const id of source.sourceAssetIds) this.asset(projectId, id)
    const versions = this.versions(projectId).filter(
      (v) => v.assetId === assetId,
    )
    const item = assetVersionSchema.parse({
      ...metadata(),
      projectId,
      assetId,
      versionNumber: Math.max(0, ...versions.map((v) => v.versionNumber)) + 1,
      status: 'draft',
      ...stored,
      ...source,
    })
    this.repo.database.connection
      .prepare('INSERT INTO asset_versions VALUES (?,?,?,?,?,?)')
      .run(
        item.id,
        projectId,
        assetId,
        item.versionNumber,
        item.hash,
        JSON.stringify(item),
      )
    const asset = this.asset(projectId, assetId)
    this.repo.updateEntity(projectId, assetId, asset.revision, {
      status: 'ready',
    })
    return item
  }
  async importFile(
    projectId: string,
    path: string,
    name: string,
    assetId: string | null,
  ) {
    this.repo.database.get(projectId)
    const id = assetId ?? randomUUID()
    if (assetId) this.asset(projectId, assetId)
    const stored = await this.storage.importFile(projectId, id, path)
    // Content deduplication reuses an existing Asset when importing as a new asset.
    const duplicate = this.versions(projectId).find(
      (v) => v.hash === stored.hash && (!assetId || v.assetId === assetId),
    )
    if (duplicate) return duplicate
    return this.repo.database.transaction(() => {
      if (!assetId)
        this.repo.database.insertEntities(projectId, [
          {
            ...metadata(),
            id,
            projectId,
            kind: 'asset',
            name: name.slice(0, 120) || '导入图片',
            description: '',
            mediaType: 'image',
            uri: null,
            status: 'placeholder',
            source: null,
            previousVersionId: null,
          },
        ])
      return this.commitVersion(projectId, id, stored, {
        sourceType: 'imported',
        provider: null,
        model: null,
        prompt: '',
        negativePrompt: '',
        generationTaskId: null,
        sourceAssetIds: [],
        metadata: {},
      })
    })
  }
  saveReferences(
    projectId: string,
    id: string,
    revision: number,
    references: VisualReference[],
  ) {
    const target = this.repo.entity(projectId, id)
    if (
      target.kind !== 'character' &&
      target.kind !== 'location' &&
      target.kind !== 'prop'
    )
      throw new DomainError('CONFLICT', '只支持 Bible 参考图')
    const allowed =
      target.kind === 'character'
        ? [
            'faceReference',
            'fullBodyReference',
            'costumeReference',
            'expressionReference',
          ]
        : target.kind === 'location'
          ? ['masterReference', 'angleReference', 'lightingReference']
          : ['masterReference', 'detailReference']
    if (
      references.some((r) => !allowed.includes(r.role)) ||
      new Set(references.map((r) => r.assetId + ':' + r.role)).size !==
        references.length ||
      references.filter((r) => r.primary).length > 1
    )
      throw new DomainError('CONFLICT', '参考图角色无效、重复或存在多个主参考')
    for (const ref of references) {
      const asset = this.asset(projectId, ref.assetId)
      if (ref.primary && !asset.approvedVersionId)
        throw new DomainError('CONFLICT', '请先审核批准主参考素材的版本')
    }
    const removed = new Set(
      target.visualReferences
        .filter((old) => !references.some((r) => r.assetId === old.assetId))
        .map((r) => r.assetId),
    )
    return this.repo.updateEntity(projectId, id, revision, {
      visualReferences: references,
      assetIds: [
        ...new Set([
          ...target.assetIds.filter((a) => !removed.has(a)),
          ...references.map((r) => r.assetId),
        ]),
      ],
    })
  }
  review(
    projectId: string,
    id: string,
    revision: number,
    status: AssetVersion['status'],
    targetId: string | null,
    targetRevision: number | null,
  ) {
    return this.repo.database.transaction(() => {
      const version = this.version(projectId, id)
      this.repo.checkRevision(version.revision, revision)
      const asset = this.asset(projectId, version.assetId)
      const entities = this.repo.database.workspace(projectId).entities
      if (
        status !== 'approved' &&
        (asset.approvedVersionId === id ||
          entities.some(
            (e) => e.kind === 'shot' && e.approvedKeyframeVersionId === id,
          ))
      )
        throw new DomainError(
          'CONFLICT',
          '该版本仍是主版本或已确认关键帧，请先明确替换引用',
        )
      if (status === 'approved') {
        for (const old of this.versions(projectId).filter(
          (v) =>
            v.assetId === asset.id && v.status === 'approved' && v.id !== id,
        ))
          this.writeVersion({
            ...old,
            status: 'archived',
            revision: old.revision + 1,
            updatedAt: new Date().toISOString(),
          })
        this.repo.updateEntity(projectId, asset.id, asset.revision, {
          approvedVersionId: id,
        })
        if (targetId) {
          const target = this.repo.entity(projectId, targetId)
          if (targetRevision === null)
            throw new DomainError('CONFLICT', '缺少目标版本')
          this.repo.checkRevision(target.revision, targetRevision)
          if (target.kind === 'shot')
            this.repo.updateEntity(projectId, targetId, targetRevision, {
              approvedKeyframeAssetId: asset.id,
              approvedKeyframeVersionId: id,
              assetIds: [...new Set([...target.assetIds, asset.id])],
            })
          else if (
            target.kind === 'character' ||
            target.kind === 'location' ||
            target.kind === 'prop'
          )
            this.saveReferences(projectId, targetId, targetRevision, [
              ...target.visualReferences
                .filter((r) => r.assetId !== asset.id)
                .map((r) => ({ ...r, primary: false })),
              {
                assetId: asset.id,
                role:
                  target.kind === 'character'
                    ? 'faceReference'
                    : 'masterReference',
                primary: true,
              },
            ])
          else throw new DomainError('CONFLICT', '只能绑定 Bible 或 Shot')
        }
      }
      return this.writeVersion({
        ...version,
        status,
        revision: version.revision + 1,
        updatedAt: new Date().toISOString(),
      })
    })
  }
  private writeVersion(item: AssetVersion) {
    const parsed = assetVersionSchema.parse(item)
    this.repo.database.connection
      .prepare('UPDATE asset_versions SET data=? WHERE id=?')
      .run(JSON.stringify(parsed), item.id)
    return parsed
  }
  deleteAsset(projectId: string, id: string, revision: number) {
    return this.repo.database.transaction(() => {
      const asset = this.asset(projectId, id)
      this.repo.checkRevision(asset.revision, revision)
      const referenced = this.repo.database.connection
        .prepare(
          'SELECT 1 FROM entity_refs WHERE project_id=? AND target_id=? LIMIT 1',
        )
        .get(projectId, id)
      if (
        referenced ||
        this.versions(projectId).some(
          (v) => v.assetId !== id && v.sourceAssetIds.includes(id),
        )
      )
        throw new DomainError(
          'CONFLICT',
          '素材仍被实体或派生版本引用，请先移除引用',
        )
      const tasks = this.repo.snapshot(projectId, '').tasks
      if (
        tasks.some(
          (t) =>
            'assetId' in t.input &&
            (t.input.assetId === id ||
              t.input.request.prompt.referenceAssetIds.includes(id)),
        )
      )
        throw new DomainError(
          'CONFLICT',
          '素材仍在任务来源记录中，请保留并归档版本',
        )
      this.repo.database.connection
        .prepare('DELETE FROM entities WHERE project_id=? AND id=?')
        .run(projectId, id)
      // Files are retained for orphan scanning; deletion never unlinks a shared file.
      return null
    })
  }
  async media(projectId: string, id: string, thumbnail: boolean) {
    const v = this.version(projectId, id)
    const bytes = await this.storage.read(
      thumbnail ? v.thumbnailPath : v.storageKey,
    )
    return `data:${thumbnail ? 'image/webp' : v.mimeType};base64,${bytes.toString('base64')}`
  }
  async scan() {
    const keys = new Set(
      this.repo.database
        .list()
        .flatMap((p) =>
          this.versions(p.id).flatMap((v) => [v.storageKey, v.thumbnailPath]),
        ),
    )
    return this.storage.scan(keys)
  }
}
