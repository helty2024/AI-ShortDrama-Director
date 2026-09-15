import { randomUUID, createHash } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { ProjectDatabase, metadata, references } from '../../electron/main/database.js'
import { buildSeed } from '../../electron/main/seed.js'
import { projectSchema } from '../../src/shared/domain.js'
import { aiTaskSchema } from '../../src/shared/intelligence.js'
import { assetVersionSchema } from '../../src/shared/visual.js'
import { persistedRecordSchema } from '../../src/shared/provenance.js'
import { GenerationRepository } from '../../electron/main/generation/repository.js'
import { GenerationService } from '../../electron/main/generation/service.js'
import { ToolRegistry } from '../../electron/main/tools/registry.js'
import { ToolBroker } from '../../electron/main/tools/broker.js'
import { brokerRequestSchema } from '../../electron/main/tools/broker.js'
import { MockSyncImageTool } from './tools/sync-image.js'
import { migrateIntelligence } from '../../electron/main/intelligence/migration.js'
import { migrateVisual } from '../../electron/main/visual/migration.js'
import { migrateVideo } from '../../electron/main/video/migration.js'
import { migrateProduction } from '../../electron/main/production/migration.js'
import { migrateOperations } from '../../electron/main/operations/migration.js'

export const mediaBytes = Buffer.from('isolated fixture media')
export function version(projectId: string, assetId: string, number = 1) {
  const id = randomUUID()
  return assetVersionSchema.parse({ ...metadata(), id, projectId, assetId, versionNumber: number, status: 'approved', sourceType: 'generated', mimeType: 'image/png', width: 1024, height: 1024, fileSize: mediaBytes.length, hash: createHash('sha256').update(mediaBytes).digest('hex'), storageKey: `${projectId}/${assetId}/${id}.png`, thumbnailPath: `${projectId}/${assetId}/${id}-thumb.png`, provider: 'mock', model: null, prompt: '', negativePrompt: '', generationTaskId: null, sourceAssetIds: [], metadata: {} })
}
export function insertVersion(db: DatabaseSync, v: ReturnType<typeof version>) { db.prepare('INSERT INTO asset_versions(id,project_id,asset_id,version_number,hash,data) VALUES (?,?,?,?,?,?)').run(v.id, v.projectId, v.assetId, v.versionNumber, v.hash, JSON.stringify(v)) }
export async function generationFixture(db = new ProjectDatabase(':memory:')) {
  const project = db.create({ name: 'provenance', description: '', genre: 'drama', language: 'zh-CN', aspectRatio: '9:16' })
  db.insertEntities(project.id, buildSeed(project.id))
  const target = db.workspace(project.id).entities.find(e => e.kind === 'character')!
  const asset = db.workspace(project.id).entities.find(e => e.kind === 'asset')!
  const repository = new GenerationRepository(db), service = new GenerationService(repository)
  const prompt = service.capturePrompt(project.id, target.id)
  const task = aiTaskSchema.parse({ ...metadata(), projectId: project.id, input: { type: 'characterBible', targetId: target.id }, status: 'running', attempt: 1, error: null, resultIds: [], sourceRevisions: { [target.id]: target.revision } })
  db.connection.prepare('INSERT INTO ai_tasks VALUES (?,?,?)').run(task.id, task.projectId, JSON.stringify(task))
  const tool = new MockSyncImageTool(), registry = new ToolRegistry(); registry.register(tool)
  const input = { prompt: 'positivePrompt' in prompt.compiledPrompt ? prompt.compiledPrompt.positivePrompt : '', negativePrompt: '', resolution: { width: 1024, height: 1024 }, aspectRatio: '1:1', seed: 42, count: 4, outputMime: 'image/png' }
  const request = brokerRequestSchema.parse({ projectId: project.id, requestId: task.id, snapshot: { capability: 'image.generate', contractVersion: '1.0.0', input }, policy: { version: '1.0.0', selection: { mode: 'AUTO' }, hardConstraints: { locality: 'either', allowAssetUpload: true, budget: null, requiredAvailability: 'available', availableMemoryMB: null, availableGpuMemoryMB: null, networkAvailable: true }, preferences: { order: [], quality: { status: 'unknown' } }, unknown: { cost: 'allow', duration: 'allow', quality: 'allow', resources: 'allow' } } })
  const preflight = await new ToolBroker(registry).preflight(request, new AbortController().signal)
  if (!preflight.ready) throw new Error('Fixture preflight failed')
  const decision = repository.create('routing_decisions', preflight.routingDecision)
  const estimate = repository.create('generation_estimates', preflight.estimate)
  const record = persistedRecordSchema.parse({ id: randomUUID(), projectId: project.id, targetObjectId: target.id, targetObjectType: target.kind, generationType: 'image.generate', sourceRevisions: { [target.id]: target.revision }, inputAssetVersionIds: [], skillId: null, skillVersion: null, workflowTemplateId: null, workflowVersion: null, promptPackageId: prompt.id, routingDecisionId: decision.id, toolId: decision.selectedToolId, toolVersion: decision.selectedToolVersion, modelId: decision.selectedModel, parameters: request.snapshot, requestFingerprint: estimate.requestFingerprint, seed: 42, estimateId: estimate.id, approvalId: null, estimatedCost: estimate.cost, actualCost: null, currency: 'USD', costStatus: 'unknown', taskId: task.id, parentGenerationRecordId: null, attemptType: 'initial', createdAt: task.createdAt, updatedAt: task.createdAt, startedAt: task.createdAt, completedAt: null, actualDuration: null, outputAssetVersionIds: [], outcome: 'pending' })
  const versions = Array.from({ length: 5 }, (_, i) => version(project.id, asset.id, i + 1))
  versions[4].sourceType = 'imported'
  for (const v of versions) insertVersion(db.connection, v)
  const outputs = versions.slice(0, 4).map((v, i) => ({ id: randomUUID(), projectId: project.id, generationRecordId: record.id, assetVersionId: v.id, outputIndex: i, role: 'candidate', createdAt: task.createdAt }))
  return { db, project, target, asset, repository, service, task, prompt, decision, estimate, record, versions, outputs }
}

/** Real v6 schema produced by the published migrations, not a relabelled v7 database. */
export function createV6(path: string) {
  const db = new DatabaseSync(path)
  db.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE projects(id TEXT PRIMARY KEY,data TEXT NOT NULL CHECK(json_valid(data)));
    CREATE TABLE entities(id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,kind TEXT NOT NULL,data TEXT NOT NULL CHECK(json_valid(data)),UNIQUE(project_id,id));
    CREATE INDEX entities_project_kind ON entities(project_id,kind);
    CREATE TABLE entity_refs(project_id TEXT NOT NULL,source_id TEXT NOT NULL,target_id TEXT NOT NULL,PRIMARY KEY(source_id,target_id),FOREIGN KEY(project_id,source_id) REFERENCES entities(project_id,id) ON DELETE CASCADE,FOREIGN KEY(project_id,target_id) REFERENCES entities(project_id,id) ON DELETE CASCADE);
    CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT NOT NULL); PRAGMA user_version=1;`)
  for (const migrate of [migrateIntelligence, migrateVisual, migrateVideo, migrateProduction, migrateOperations]) migrate(db)
  const project = projectSchema.parse({ ...metadata(), name: 'legacy', description: '', genre: 'drama', language: 'zh-CN', aspectRatio: '9:16', lastOpenedAt: null })
  const entities = buildSeed(project.id), shot = entities.find(e => e.kind === 'shot')!, asset = entities.find(e => e.kind === 'asset')!
  const v = version(project.id, asset.id)
  if (shot.kind === 'shot') { shot.approvedKeyframeAssetId = asset.id; shot.approvedKeyframeVersionId = v.id }
  const task = aiTaskSchema.parse({ ...metadata(), projectId: project.id, input: { type: 'shotPlanning', targetId: shot.id }, status: 'succeeded', attempt: 2, error: null, resultIds: [v.id], sourceRevisions: { [shot.id]: shot.revision }, providerTaskId: 'legacy-remote-123' })
  db.prepare('INSERT INTO projects VALUES (?,?)').run(project.id, JSON.stringify(project))
  for (const e of entities) db.prepare('INSERT INTO entities VALUES (?,?,?,?)').run(e.id, project.id, e.kind, JSON.stringify(e))
  for (const e of entities) for (const r of references(e)) db.prepare('INSERT OR IGNORE INTO entity_refs VALUES (?,?,?)').run(project.id, e.id, r.id)
  insertVersion(db, v)
  db.prepare('INSERT INTO ai_tasks VALUES (?,?,?)').run(task.id, project.id, JSON.stringify(task))
  db.close()
  return { project, entities, version: v, task }
}

// Only existing downgrade-style tests need to remove newly added empty v7 structures.
export function removeEmptyV7(db: DatabaseSync) {
  for (const table of ['generation_outputs', 'import_provenance', 'task_generation_links', 'generation_records', 'prompt_packages', 'generation_estimates', 'routing_decisions']) db.exec(`DROP TABLE ${table}`)
  for (const trigger of ['version_provenance_retention', 'source_provenance_retention']) db.exec(`DROP TRIGGER ${trigger}`)
  db.exec('DROP INDEX tasks_scope_id; DROP INDEX versions_scope_id;')
}
