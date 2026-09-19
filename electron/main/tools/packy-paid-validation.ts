import { createHash } from 'node:crypto'
import { connect } from 'node:net'
import { mkdir, open, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app, safeStorage } from 'electron'
import sharp from 'sharp'
import { z } from 'zod'
import { entitySchema } from '../../../src/shared/domain.js'
import { ProjectDatabase, metadata } from '../database.js'
import { IntelligenceRepository } from '../intelligence/repository.js'
import { VisualRepository } from '../visual/repository.js'
import { MediaStorage } from '../visual/storage.js'
import { EncryptedCredentialStore } from '../video/credentials.js'
import { ImageGenerationService } from '../generation/image-service.js'
import { loadImageProfiles } from '../generation/image-profiles.js'
import {
  PackyImage25Adapter,
  packyImage25ProfileSchema,
  type PackyPaidValidationGate,
  type PackyOutputDiagnostic,
} from './adapters/packy-image-25.js'
import type { ImageCapability, ImageApiTool } from './adapters/image-api.js'
import type { CapabilityInput } from '../../../src/shared/capabilities/index.js'
import type { ToolExecutionContext } from '../../../src/shared/tools.js'

const projectName = '07-06.6 Packy 最小真实验证'
const targetName = 'Packy minimal Images API validation target'
const promptSeed = 'A red apple on a white table'
const authorizationCeilingMicro = 400_000
let validationStage = 'startup'

function preserveValidationDatabaseError(
  service: ImageGenerationService,
): void {
  const repository = service.approvals.repository
  let savepointSequence = 0
  repository.atomic = function atomic<T>(action: () => T): T {
    if (!repository.database.connection.isTransaction)
      return repository.database.transaction(action)
    const savepoint = `packy_validation_${++savepointSequence}`
    repository.database.connection.exec(`SAVEPOINT ${savepoint}`)
    try {
      const result = action()
      repository.database.connection.exec(`RELEASE ${savepoint}`)
      return result
    } catch (error) {
      repository.database.connection.exec(
        `ROLLBACK TO ${savepoint}; RELEASE ${savepoint}`,
      )
      throw error
    }
  }
}

class OneShotPaidGate implements PackyPaidValidationGate {
  expectedPrompt = ''
  private readonly intentPath: string
  constructor(intentPath: string) {
    this.intentPath = intentPath
  }
  async consume(
    capability: ImageCapability,
    input: CapabilityInput<ImageCapability>,
    context: ToolExecutionContext,
  ) {
    if (
      capability !== 'image.generate' ||
      'references' in input ||
      input.prompt !== this.expectedPrompt ||
      input.count !== 1 ||
      input.aspectRatio !== '1:1' ||
      input.resolution.width !== 1024 ||
      input.resolution.height !== 1024 ||
      input.seed !== null ||
      input.outputMime !== 'image/png' ||
      context.model !== 'gpt-image-2.5-sunburst' ||
      !context.approvalId
    )
      throw new Error('Paid validation scope mismatch')
    const handle = await open(this.intentPath, 'wx', 0o600)
    try {
      await handle.writeFile(
        JSON.stringify({
          createdAt: new Date().toISOString(),
          status: 'submission-intent',
          provider: 'PackyAPI',
          model: context.model,
          capability,
          count: input.count,
          size: input.resolution,
          aspectRatio: input.aspectRatio,
          requestFingerprint: context.requestFingerprint,
          approvalId: context.approvalId,
          taskId: context.taskId,
        }),
      )
    } finally {
      await handle.close()
    }
  }
}

function secretEncryption() {
  return {
    available: () =>
      safeStorage.isEncryptionAvailable() &&
      (process.platform !== 'linux' ||
        safeStorage.getSelectedStorageBackend() !== 'basic_text'),
    encrypt: (value: string) => safeStorage.encryptString(value),
    decrypt: (value: Buffer) => safeStorage.decryptString(value),
  }
}

async function confirmation(pipe: string, phrase: string) {
  const channel = connect(
    ['', '', '.', 'pipe', pipe].join(String.fromCharCode(92)),
  )
  return new Promise<void>((resolve, reject) => {
    let value = ''
    const timer = setTimeout(
      () => {
        channel.destroy()
        reject(new Error('Confirmation expired'))
      },
      25 * 60 * 1000,
    )
    channel.setEncoding('utf8')
    channel.on('error', reject)
    channel.on('data', (chunk: string) => {
      value += chunk
      if (value.length > 500) {
        clearTimeout(timer)
        channel.destroy()
        reject(new Error('Confirmation too long'))
      }
      if (value.includes('\n')) {
        clearTimeout(timer)
        channel.destroy()
        if (value.trim() !== phrase) reject(new Error('Confirmation mismatch'))
        else resolve()
      }
    })
  })
}

async function main() {
  await app.whenReady()
  validationStage = 'configuration'
  const pipe = process.argv
    .find((value) => value.startsWith('--confirmation-pipe='))
    ?.slice('--confirmation-pipe='.length)
  if (!pipe || !/^director-packy-paid-[a-f0-9-]+$/.test(pipe))
    throw new Error('Missing confirmation channel')
  const userData = join(app.getPath('appData'), 'ai-shortdrama-director')
  const diagnostics = join(userData, 'diagnostics')
  const intentPath = join(
    diagnostics,
    'packy-paid-validation-v3-intent.json',
  )
  const reportPath = join(
    diagnostics,
    'packy-paid-validation-v3-report.json',
  )
  await mkdir(diagnostics, { recursive: true })
  try {
    await readFile(intentPath)
    throw new Error(
      'A paid validation intent already exists; refusing another request',
    )
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT'))
      throw error
  }
  const credentials = new EncryptedCredentialStore(
    join(userData, 'credentials'),
    secretEncryption(),
  )
  const profiles = await loadImageProfiles(
    join(userData, 'image-api-profiles.json'),
  )
  const rawProfile = profiles.find(
    (profile) => 'adapter' in profile && profile.adapter === 'packy-image-25',
  )
  const profile = packyImage25ProfileSchema.parse(rawProfile)
  if (!profile.credentialRef) throw new Error('Packy credential is missing')
  const credentialRef = profile.credentialRef
  const gate = new OneShotPaidGate(intentPath)
  const outputDiagnostics: PackyOutputDiagnostic[] = []
  const adapter: ImageApiTool = new PackyImage25Adapter(
    profile,
    () => credentials.get(credentialRef),
    undefined,
    gate,
    (event) => outputDiagnostics.push(event),
  )
  const database = new ProjectDatabase(join(userData, 'workspace.sqlite'))
  try {
    const project =
      database.list().find((value) => value.name === projectName) ??
      database.create({
        name: projectName,
        description: '一次性 PackyAPI 真实付费生产链验证；保留结果用于审计。',
        genre: 'validation',
        language: 'en',
        aspectRatio: '1:1',
      })
    const target =
      database
        .workspace(project.id)
        .entities.find(
          (value) =>
            value.kind === 'character' &&
            value.name === targetName,
        ) ??
      entitySchema.parse({
        ...metadata(),
        projectId: project.id,
        kind: 'character',
        name: targetName,
        description: promptSeed,
        appearance: '',
        assetIds: [],
      })
    if (
      !database
        .workspace(project.id)
        .entities.some((value) => value.id === target.id)
    )
      database.insertEntities(project.id, [target])
    const visual = new VisualRepository(
      new IntelligenceRepository(database),
      new MediaStorage(join(userData, 'media')),
    )
    const service = new ImageGenerationService(visual, [adapter])
    preserveValidationDatabaseError(service)
    validationStage = 'connectivity'
    const connectivity = await service.probe(profile.toolId)
    if (
      connectivity.authentication !== 'accepted' ||
      connectivity.modelVisible !== true
    )
      throw new Error('Packy connectivity is not ready')
    validationStage = 'preview'
    const preview = await service.preview(
      {
        projectId: project.id,
        targetId: target.id,
        toolId: profile.toolId,
        resolution: { width: 1024, height: 1024 },
        aspectRatio: '1:1',
        count: 1,
        references: [],
        allowAssetUpload: true,
        localOnly: false,
      },
      {
        positivePrompt: promptSeed,
        compilerVersion: 'packy-paid-validation-v3',
      },
    )
    gate.expectedPrompt = preview.prompt
    const phrase = `CONFIRM PACKY ONE PAID IMAGE ${preview.id}`
    process.stdout.write(
      JSON.stringify({
        state: 'awaiting-explicit-confirmation',
        provider: 'PackyAPI',
        model: profile.modelId,
        endpoint: 'https://cf.api.fan/v1/images/generations',
        endpointType: 'image-generation',
        prompt: preview.prompt,
        outputCount: 1,
        aspectRatio: '1:1',
        requestBody: {
          model: profile.modelId,
          prompt: preview.prompt,
          n: 1,
        },
        omittedProviderFields: [
          'size',
          'quality',
          'output_format',
          'response_format',
        ],
        estimate: 'USD 0.4000 per request',
        currency: preview.currency,
        maximumLocalReservationMicro: authorizationCeilingMicro,
        maximumLocalReservationWarning:
          '本地预留等于供应商确认的单次请求价格。',
        cloudDisclosure:
          '将 Prompt 和生成参数发送给 PackyAPI；不上传参考素材。',
        minimalImagesApiRequestsSoFar: 0,
        historicalGenerationRequests: 2,
        expiresAt: preview.expiresAt,
        confirmationPhrase: phrase,
      }) + '\n',
    )
    validationStage = 'awaiting-explicit-confirmation'
    await confirmation(pipe, phrase)
    validationStage = 'post-confirmation-revalidation'
    const refreshed = await service.refreshForConfirmation(preview.id)
    if (
      refreshed.id !== preview.id ||
      refreshed.prompt !== promptSeed ||
      refreshed.tool !== preview.tool ||
      refreshed.model !== profile.modelId ||
      refreshed.count !== 1 ||
      refreshed.resolution.width !== 1024 ||
      refreshed.resolution.height !== 1024 ||
      refreshed.currency !== 'USD' ||
      refreshed.estimate !== preview.estimate
    )
      throw new Error(
        'Post-confirmation preflight changed an authorized request field',
      )
    validationStage = 'approval-and-reservation'
    const task = service.confirm(
      project.id,
      preview.id,
      authorizationCeilingMicro,
      false,
    )
    validationStage = 'provider-execution'
    await service.wait(task.id)
    validationStage = 'output-verification'
    const query = service.query(project.id, task.id)
    let reviewed = false
    let adopted = false
    let output: null | {
      versionId: string
      mimeType: string
      width: number
      height: number
      hash: string
      status: string
    } = null
    if (query.task.status === 'succeeded' && query.versions.length === 1) {
      const candidate = query.versions[0]
      const bytes = await visual.storage.read(candidate.storageKey)
      const decoded = await sharp(bytes, {
        failOn: 'error',
        limitInputPixels: 40_000_000,
      }).metadata()
      if (
        createHash('sha256').update(bytes).digest('hex') !== candidate.hash ||
        decoded.width !== 1024 ||
        decoded.height !== 1024
      )
        throw new Error('Persisted image verification failed')
      const adoptedVersion = service.review(
        project.id,
        candidate.id,
        candidate.revision,
        true,
        target.revision,
      )
      reviewed = adoptedVersion.status === 'approved'
      const updatedTarget = visual.repo.entity(project.id, target.id)
      adopted =
        'visualReferences' in updatedTarget &&
        updatedTarget.visualReferences.some(
          (reference) =>
            reference.primary && reference.assetId === adoptedVersion.assetId,
        )
      output = {
        versionId: adoptedVersion.id,
        mimeType: adoptedVersion.mimeType,
        width: adoptedVersion.width,
        height: adoptedVersion.height,
        hash: adoptedVersion.hash,
        status: adoptedVersion.status,
      }
    }
    validationStage = 'reporting'
    const reservation = service.approvals.repository
      .list('approval_reservations', project.id)
      .find((value) => value.taskId === task.id)
    const report = {
      checkedAt: new Date().toISOString(),
      provider: 'PackyAPI',
      model: profile.modelId,
      endpoint: 'https://cf.api.fan/v1/images/generations',
      requestSent:
        reservation?.submissionIntentAt !== null &&
        reservation?.submissionIntentAt !== undefined,
      realImageReturned: output !== null,
      candidateAssetVersionCreated: query.versions.length === 1,
      reviewPassed: reviewed,
      adoptPassed: adopted,
      generationRecordComplete:
        query.record.promptPackageId !== null &&
        query.record.routingDecisionId.length > 0 &&
        query.record.estimateId.length > 0 &&
        query.record.approvalId !== null &&
        query.record.outputAssetVersionIds.length === 1,
      reservationStatus: reservation?.status ?? null,
      actualCost: query.record.actualCost,
      unknownSubmission: query.record.outcome === 'unknown-submission',
      outcome: query.record.outcome,
      projectId: project.id,
      targetId: target.id,
      taskId: task.id,
      generationRecordId: query.record.id,
      output,
      outputDiagnostics,
      paidGenerationValidated:
        query.record.outcome === 'succeeded' && reviewed && adopted,
    }
    await writeFile(reportPath, JSON.stringify(report, null, 2), {
      mode: 0o600,
    })
    await writeFile(
      intentPath,
      JSON.stringify({
        ...(JSON.parse(await readFile(intentPath, 'utf8')) as object),
        finishedAt: report.checkedAt,
        outcome: report.outcome,
        reportPath,
      }),
      { mode: 0o600 },
    )
    process.stdout.write(JSON.stringify({ ...report, reportPath }) + '\n')
    validationStage = 'complete'
  } finally {
    database.close()
  }
}

void main()
  .then(() => app.exit(0))
  .catch((error: unknown) => {
    const structured = z
      .object({
        code: z.string().max(100).optional(),
        message: z.string().max(1000).optional(),
      })
      .safeParse(error)
    const message = (
      error instanceof Error
        ? error.message
        : structured.success
          ? structured.data.message ?? structured.data.code ?? 'Validation failed'
          : 'Validation failed'
    ).replace(/[A-Za-z0-9_-]{24,}/g, '[redacted]')
    process.stdout.write(
      JSON.stringify({
        state: 'failed-before-or-during-validation',
        stage: validationStage,
        message,
      }) +
        '\n',
    )
    app.exit(1)
  })
