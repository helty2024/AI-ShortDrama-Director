import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  capabilityContracts,
  capabilitySnapshotSchema,
} from '../../src/shared/capabilities/index.js'
import type { CapabilityInput } from '../../src/shared/capabilities/index.js'
import { durationRangeSchema } from '../../src/shared/capabilities/common.js'
import {
  toolDescriptorSchema,
  toolCapabilityDescriptorSchema,
  toolValidationSchema,
  toolCancelResultSchema,
  toolRecoverResultSchema,
  toolTaskStatusSchema,
  toolSubmitResultSchema,
  toolResultSchema,
  toolErrorSchema,
} from '../../src/shared/tools.js'
import {
  generationEstimateSchema,
  generationApprovalSchema,
  generationRecordSchema,
  importProvenanceSchema,
  fingerprintMaterialSchema,
  stepRunSchema,
} from '../../src/shared/generation.js'
import {
  routingPolicySchema,
  routingDecisionSchema,
} from '../../src/shared/routing.js'
import { requestFingerprint } from '../../electron/main/tools/fingerprint.js'
import { normalizeToolError } from '../../electron/main/tools/errors.js'

const id = '00000000-0000-4000-8000-000000000001'
const other = '00000000-0000-4000-8000-000000000002'
const now = '2026-09-13T00:00:00.000Z'
const later = '2026-09-13T01:00:00.000Z'
const image: CapabilityInput<'image.generate'> = {
  prompt: '雨夜车站',
  negativePrompt: '',
  resolution: { width: 768, height: 1024 },
  aspectRatio: '3:4',
  seed: 42,
  count: 1,
  outputMime: 'image/png',
}
const video: CapabilityInput<'video.textToVideo'> = {
  prompt: '人物走向车站',
  negativePrompt: '',
  resolution: { width: 1280, height: 720 },
  aspectRatio: '16:9',
  seed: null,
  durationSeconds: 5,
  fps: 24,
  outputMime: 'video/mp4',
  audio: 'none',
}
const material = {
  fingerprintVersion: '1',
  snapshot: {
    capability: 'image.generate',
    contractVersion: '1.0.0',
    input: image,
  },
  toolId: 'example.image',
  toolVersion: '1.0.0',
  model: 'image-model',
  sourceRevisions: { [id]: 1 },
  routing: null,
}
const fingerprint = requestFingerprint(material)
const resources = {
  memoryMB: { status: 'unknown' },
  gpuMemoryMB: { status: 'unsupported' },
  dependencies: [],
}
const capability = {
  capability: 'image.generate',
  contractVersion: '1.0.0',
  models: { status: 'unknown' },
  inputKinds: ['text'],
  referenceImages: { status: 'unsupported' },
  aspectRatios: { status: 'known', value: ['3:4'] },
  resolutions: { status: 'known', value: [image.resolution] },
  durationSeconds: { status: 'unsupported' },
  outputMimes: ['image/png'],
  seed: 'supported',
  cancel: 'unsupported',
  recover: 'unknown',
  estimate: 'unsupported',
  locality: 'cloud',
  resources,
}
const descriptor = {
  metadataVersion: '1.0.0',
  id: 'example.image',
  name: 'Example',
  version: '1.0.0',
  kind: 'api',
  executionMode: 'cloud',
  availability: 'unknown',
  capabilities: [capability],
}
const estimate = {
  id,
  projectId: id,
  routingDecisionId: id,
  requestFingerprint: fingerprint,
  cost: {
    status: 'known',
    estimatedCost: { amountMicros: 200000, currency: 'USD' },
  },
  estimatedDurationRange: { status: 'known', seconds: { min: 1, max: 20 } },
  billingRisk: 'may-charge',
  basis: 'fixture price, no service call',
  createdAt: now,
  validUntil: later,
}
const handle = {
  toolId: 'example.image',
  toolVersion: '1.0.0',
  externalTaskId: 'external-1',
}
const imageOutput = {
  images: [
    { handle: 'output-1', mime: 'image/png', resolution: image.resolution },
  ],
}
const policy = {
  version: '1.0.0',
  selection: { mode: 'AUTO' },
  hardConstraints: {
    locality: 'local-only',
    allowAssetUpload: false,
    budget: null,
    requiredAvailability: 'available',
    availableMemoryMB: null,
    availableGpuMemoryMB: null,
  },
  preferences: { order: ['cost', 'speed'], quality: { status: 'unknown' } },
}
const record = {
  id,
  projectId: id,
  targetObjectId: other,
  generationType: 'image.generate',
  sourceRevisions: { [other]: 1 },
  inputAssetVersionIds: [],
  skillId: null,
  skillVersion: null,
  workflowTemplateId: null,
  workflowVersion: null,
  promptPackageId: null,
  routingDecisionId: id,
  toolId: 'example.image',
  toolVersion: '1.0.0',
  modelId: 'image-model',
  parameters: material.snapshot,
  requestFingerprint: fingerprint,
  seed: 42,
  estimateId: id,
  approvalId: null,
  estimatedCost: estimate.cost,
  actualCost: null,
  currency: 'USD',
  costStatus: 'unknown',
  taskId: id,
  parentGenerationRecordId: null,
  attemptType: 'initial',
  createdAt: now,
  updatedAt: now,
  startedAt: now,
  completedAt: later,
  actualDuration: 30,
  outputAssetVersionIds: [],
  outcome: 'failed',
}

test('image generation and reference generation have separate valid contracts', () => {
  assert.ok(
    capabilityContracts['image.generate'].input.safeParse(image).success,
  )
  const reference = {
    ...image,
    references: [{ assetVersionId: id, role: 'identity', weight: 1 }],
  }
  assert.ok(
    capabilityContracts['image.referenceGenerate'].input.safeParse(reference)
      .success,
  )
  assert.equal(
    capabilityContracts['image.generate'].input.safeParse(reference).success,
    false,
  )
  assert.equal(
    capabilityContracts['image.referenceGenerate'].input.safeParse(image)
      .success,
    false,
  )
})
test('video text and image inputs and output validate independently', () => {
  assert.ok(
    capabilityContracts['video.textToVideo'].input.safeParse(video).success,
  )
  const framed = {
    ...video,
    firstFrameAssetVersionId: id,
    lastFrameAssetVersionId: null,
  }
  assert.ok(
    capabilityContracts['video.imageToVideo'].input.safeParse(framed).success,
  )
  assert.equal(
    capabilityContracts['video.textToVideo'].input.safeParse(framed).success,
    false,
  )
  assert.equal(
    capabilityContracts['video.imageToVideo'].input.safeParse(video).success,
    false,
  )
  assert.ok(
    capabilityContracts['video.imageToVideo'].output.safeParse({
      videos: [
        {
          handle: 'v1',
          mime: 'video/mp4',
          resolution: video.resolution,
          durationSeconds: 5,
        },
      ],
    }).success,
  )
})
test('cross-capability payload, missing prompt and arbitrary provider params are rejected', () => {
  for (const input of [
    video,
    { ...image, prompt: '' },
    { ...image, params: { script: 'run' } },
  ])
    assert.equal(
      capabilityContracts['image.generate'].input.safeParse(input).success,
      false,
    )
})
test('reference arrays have a strict count bound and bounded weights', () => {
  const schema = capabilityContracts['image.referenceGenerate'].input
  assert.equal(
    schema.safeParse({
      ...image,
      references: Array.from({ length: 9 }, () => ({
        assetVersionId: id,
        role: 'identity',
        weight: 1,
      })),
    }).success,
    false,
  )
  assert.equal(
    schema.safeParse({
      ...image,
      references: [{ assetVersionId: id, role: 'identity', weight: 2 }],
    }).success,
    false,
  )
})
test('resolution rejects zero, fractional and oversized dimensions', () => {
  for (const width of [0, 12.5, 16385, Infinity])
    assert.equal(
      capabilityContracts['image.generate'].input.safeParse({
        ...image,
        resolution: { width, height: 512 },
      }).success,
      false,
    )
})
test('duration ranges cannot be negative or inverted', () => {
  for (const range of [
    { min: 5, max: 1 },
    { min: -1, max: 2 },
    { min: 0, max: Infinity },
  ])
    assert.equal(durationRangeSchema.safeParse(range).success, false)
  assert.ok(durationRangeSchema.safeParse({ min: 1, max: 1 }).success)
  assert.equal(
    capabilityContracts['video.textToVideo'].input.safeParse({
      ...video,
      durationSeconds: 0,
    }).success,
    false,
  )
})
test('all capability snapshots are versioned and reject mismatched payloads', () => {
  assert.ok(capabilitySnapshotSchema.safeParse(material.snapshot).success)
  assert.equal(
    capabilitySnapshotSchema.safeParse({
      ...material.snapshot,
      capability: 'video.textToVideo',
    }).success,
    false,
  )
  assert.equal(
    capabilitySnapshotSchema.safeParse({
      ...material.snapshot,
      contractVersion: '2.0.0',
    }).success,
    false,
  )
})
test('text, scene and media contracts remain bounded typed capability payloads', () => {
  assert.ok(
    capabilityContracts['text.structured'].input.safeParse({
      instruction: 'extract',
      sourceText: 'scene',
      fields: [{ name: 'title', type: 'string', description: '' }],
    }).success,
  )
  const scene = {
    sceneAssetVersionId: id,
    camera: { position: [0, 1, 2], target: [0, 0, 0], focalLengthMm: 50 },
    resolution: image.resolution,
  }
  assert.ok(
    capabilityContracts['scene.previz'].input.safeParse({
      ...scene,
      view: 'depth',
    }).success,
  )
  assert.ok(
    capabilityContracts['scene.render'].input.safeParse({
      ...scene,
      samples: 64,
      transparent: false,
    }).success,
  )
  assert.ok(
    capabilityContracts['media.transcode'].input.safeParse({
      sourceAssetVersionId: id,
      outputMime: 'video/mp4',
      resolution: video.resolution,
      fps: 24,
      audio: 'preserve',
    }).success,
  )
})
test('known estimate rejects negative cost, inverted time and invalid expiry', () => {
  assert.ok(generationEstimateSchema.safeParse(estimate).success)
  assert.equal(
    generationEstimateSchema.safeParse({
      ...estimate,
      cost: {
        status: 'known',
        estimatedCost: { amountMicros: -1, currency: 'USD' },
      },
    }).success,
    false,
  )
  assert.equal(
    generationEstimateSchema.safeParse({
      ...estimate,
      estimatedDurationRange: { status: 'known', seconds: { min: 30, max: 1 } },
    }).success,
    false,
  )
  assert.equal(
    generationEstimateSchema.safeParse({ ...estimate, validUntil: now })
      .success,
    false,
  )
})
test('unknown and unsupported estimates cannot masquerade as zero or free', () => {
  const unknown = {
    ...estimate,
    cost: { status: 'unknown', reason: 'unsupported' },
    estimatedDurationRange: { status: 'unknown' },
    billingRisk: 'unknown',
  }
  assert.ok(generationEstimateSchema.safeParse(unknown).success)
  assert.equal(
    generationEstimateSchema.safeParse({
      ...unknown,
      cost: { ...unknown.cost, estimatedCost: 0 },
    }).success,
    false,
  )
  assert.equal(
    generationEstimateSchema.safeParse({ ...unknown, billingRisk: 'free' })
      .success,
    false,
  )
  assert.ok(
    generationEstimateSchema.safeParse({
      ...estimate,
      cost: {
        status: 'known',
        estimatedCost: { amountMicros: 0, currency: 'USD' },
      },
      billingRisk: 'free',
    }).success,
  )
})
test('validation blocking issues agree with valid; warnings are separate', () => {
  const warning = {
    code: 'resource-insufficient',
    field: null,
    message: 'fixture',
  }
  assert.ok(
    toolValidationSchema.safeParse({
      valid: true,
      issues: [],
      warnings: [warning],
      requestFingerprint: fingerprint,
    }).success,
  )
  assert.equal(
    toolValidationSchema.safeParse({
      valid: true,
      issues: [warning],
      warnings: [],
      requestFingerprint: fingerprint,
    }).success,
    false,
  )
  assert.equal(
    toolValidationSchema.safeParse({
      valid: true,
      issues: [],
      warnings: [],
      requestFingerprint: fingerprint,
      approved: true,
    }).success,
    false,
  )
})
test('descriptor rejects secrets, duplicate capabilities, wrong versions and locality', () => {
  assert.ok(toolDescriptorSchema.safeParse(descriptor).success)
  for (const value of [
    { ...descriptor, apiKey: 'secret' },
    { ...descriptor, capabilities: [capability, capability] },
    { ...descriptor, metadataVersion: '2.0.0' },
    { ...descriptor, executionMode: 'internal' },
    { ...descriptor, id: '../tool' },
  ])
    assert.equal(toolDescriptorSchema.safeParse(value).success, false)
})
test('capability metadata distinguishes unknown from unsupported and validates limits', () => {
  const parsed = toolCapabilityDescriptorSchema.parse(capability)
  assert.equal(parsed.recover, 'unknown')
  assert.equal(parsed.cancel, 'unsupported')
  assert.equal(
    toolCapabilityDescriptorSchema.safeParse({
      ...capability,
      referenceImages: { status: 'known', value: { min: 3, max: 1 } },
    }).success,
    false,
  )
})
test('cancel and recover unsupported are distinct from failures', () => {
  assert.deepEqual(toolCancelResultSchema.parse({ state: 'unsupported' }), {
    state: 'unsupported',
  })
  assert.deepEqual(toolRecoverResultSchema.parse({ state: 'unsupported' }), {
    state: 'unsupported',
  })
  assert.equal(
    toolRecoverResultSchema.safeParse({ state: 'failed' }).success,
    false,
  )
  assert.equal(
    toolCancelResultSchema.safeParse({
      state: 'waiting-stopped',
      computationMayContinue: false,
    }).success,
    false,
  )
})
test('unknown submission never permits automatic resubmit', () => {
  const status = {
    state: 'unknown',
    reason: 'submission-unconfirmed',
    resubmitAllowed: false,
  }
  assert.ok(toolTaskStatusSchema.safeParse(status).success)
  assert.equal(
    toolTaskStatusSchema.safeParse({ ...status, resubmitAllowed: true })
      .success,
    false,
  )
  assert.equal(
    toolErrorSchema.safeParse({
      code: 'unknown-submission',
      message: 'unknown',
      retryability: 'after-delay',
      details: {},
    }).success,
    false,
  )
})
test('submit covers immediate output and accepted handle without running a service', () => {
  const schema = toolSubmitResultSchema(
    capabilityContracts['image.generate'].output,
  )
  assert.ok(
    schema.safeParse({ state: 'completed', output: imageOutput }).success,
  )
  assert.ok(schema.safeParse({ state: 'accepted', handle }).success)
  assert.ok(
    schema.safeParse({
      state: 'unknown',
      error: normalizeToolError(null, true),
      resubmitAllowed: false,
    }).success,
  )
  assert.equal(schema.safeParse({ state: 'accepted' }).success, false)
})
test('malformed results reject raw URLs, wrong MIME and conflicting status', () => {
  const schema = toolResultSchema(capabilityContracts['image.generate'].output)
  assert.equal(
    schema.safeParse({
      state: 'completed',
      output: {
        images: [
          {
            handle: 'https://host/a.png',
            mime: 'image/png',
            resolution: image.resolution,
          },
        ],
      },
    }).success,
    false,
  )
  assert.equal(
    schema.safeParse({
      state: 'completed',
      output: { images: [{ ...imageOutput.images[0], mime: 'video/mp4' }] },
    }).success,
    false,
  )
  assert.equal(
    schema.safeParse({ state: 'not-ready', status: { state: 'succeeded' } })
      .success,
    false,
  )
})
test('fingerprint is stable across object key order and normalized prompt whitespace', () => {
  const reordered = { ...material, sourceRevisions: { [other]: 2, [id]: 1 } }
  const same = { ...material, sourceRevisions: { [id]: 1, [other]: 2 } }
  assert.equal(requestFingerprint(reordered), requestFingerprint(same))
  assert.equal(
    fingerprint,
    requestFingerprint({
      ...material,
      snapshot: {
        ...material.snapshot,
        input: { ...image, prompt: '  雨夜车站  ' },
      },
    }),
  )
})
test('fingerprint changes when prompt, seed, cost-affecting count, model or tool version changes', () => {
  for (const input of [
    { ...image, seed: 43 },
    { ...image, count: 2 },
    { ...image, prompt: '白天车站' },
    { ...image, resolution: { width: 512, height: 512 } },
  ])
    assert.notEqual(
      fingerprint,
      requestFingerprint({
        ...material,
        snapshot: { ...material.snapshot, input },
      }),
    )
  for (const change of [
    { model: 'other-model' },
    { toolVersion: '1.0.1' },
    { toolId: 'another.image' },
    { sourceRevisions: { [id]: 2 } },
  ])
    assert.notEqual(fingerprint, requestFingerprint({ ...material, ...change }))
})
test('fingerprint includes reference identities and order', () => {
  const reference = {
    ...material,
    snapshot: {
      capability: 'image.referenceGenerate',
      contractVersion: '1.0.0',
      input: {
        ...image,
        references: [
          { assetVersionId: id, role: 'identity', weight: 1 },
          { assetVersionId: other, role: 'style', weight: 1 },
        ],
      },
    },
  }
  assert.notEqual(
    requestFingerprint(reference),
    requestFingerprint({
      ...reference,
      snapshot: {
        ...reference.snapshot,
        input: {
          ...reference.snapshot.input,
          references: [...reference.snapshot.input.references].reverse(),
        },
      },
    }),
  )
})
test('fingerprint rejects transient IDs, timestamps, secrets and UI state', () => {
  for (const change of [
    { createdAt: now },
    { routingDecisionId: id },
    { requestId: id },
    { uiState: 'open' },
    { apiKey: 'secret' },
  ])
    assert.throws(() => requestFingerprint({ ...material, ...change }))
  assert.equal(
    fingerprintMaterialSchema.safeParse({
      ...material,
      arbitraryParameters: {},
    }).success,
    false,
  )
})
test('routing schema and semantic fingerprint define data, not selection algorithms', () => {
  assert.ok(routingPolicySchema.safeParse(policy).success)
  const withRouting = {
    ...material,
    routing: { policy, requestedCapability: 'image.generate' },
  }
  assert.notEqual(
    requestFingerprint(withRouting),
    requestFingerprint({
      ...withRouting,
      routing: {
        ...withRouting.routing,
        policy: {
          ...policy,
          preferences: { ...policy.preferences, order: ['speed', 'cost'] },
        },
      },
    }),
  )
  assert.equal(
    routingPolicySchema.safeParse({
      ...policy,
      preferences: {
        order: ['quality'],
        quality: { status: 'known', score: 0.9 },
      },
    }).success,
    false,
  )
})
test('fixed routing decision cannot silently choose another tool', () => {
  const decision = {
    id,
    projectId: id,
    workflowRunId: null,
    stepRunId: null,
    requestedCapability: 'image.generate',
    contractVersion: '1.0.0',
    routingMode: {
      mode: 'fixed',
      toolId: 'example.image',
      toolVersion: '1.0.0',
      model: null,
    },
    selectedToolId: 'other.image',
    selectedToolVersion: '1.0.0',
    selectedModel: null,
    decisionReasons: ['fixture'],
    rejectedCandidates: [],
    hardConstraints: policy.hardConstraints,
    preferenceInputs: policy.preferences,
    policyVersion: '1.0.0',
    createdAt: now,
  }
  assert.equal(routingDecisionSchema.safeParse(decision).success, false)
  assert.ok(
    routingDecisionSchema.safeParse({
      ...decision,
      selectedToolId: 'example.image',
    }).success,
  )
})
test('error normalization discards provider secrets and treats ambiguous transport as unknown', () => {
  const error = normalizeToolError({
    code: 'authentication',
    message: 'Bearer SECRET https://private/?key=SECRET',
    details: { raw: 'SECRET' },
    stack: 'SECRET',
  })
  assert.equal(error.code, 'authentication')
  assert.equal(JSON.stringify(error).includes('SECRET'), false)
  assert.equal(
    normalizeToolError({ code: 'network' }, true).retryability,
    'query-only',
  )
  assert.equal(normalizeToolError(new Error('SECRET')).code, 'provider')
  assert.equal(
    toolErrorSchema.safeParse({ ...error, details: { rawResponse: 'SECRET' } })
      .success,
    false,
  )
})
test('approval is separate from validation and supports single and batch references', () => {
  const approval = {
    id,
    projectId: id,
    requestFingerprint: fingerprint,
    routingDecisionId: id,
    estimateId: id,
    currency: 'USD',
    maxAuthorizedCost: 500000,
    approvedAt: now,
    scope: { kind: 'single', taskId: id },
  }
  assert.ok(generationApprovalSchema.safeParse(approval).success)
  assert.ok(
    generationApprovalSchema.safeParse({
      ...approval,
      scope: {
        kind: 'batch',
        batchId: id,
        items: [
          {
            requestFingerprint: fingerprint,
            routingDecisionId: id,
            estimateId: id,
          },
        ],
      },
    }).success,
  )
  assert.equal(
    generationApprovalSchema.safeParse({ ...approval, maxAuthorizedCost: -1 })
      .success,
    false,
  )
})
test('generation records retain failed attempts, support multiple outputs and reject scheduler fields', () => {
  assert.ok(generationRecordSchema.safeParse(record).success)
  assert.ok(
    generationRecordSchema.safeParse({
      ...record,
      outcome: 'succeeded',
      outputAssetVersionIds: [id, other],
    }).success,
  )
  assert.ok(
    generationRecordSchema.safeParse({
      ...record,
      parentGenerationRecordId: other,
      attemptType: 'retry',
    }).success,
  )
  for (const change of [
    { pollInterval: 1000 },
    { retryQueue: [] },
    { schedulerOwner: 'worker' },
    { attemptType: 'retry' },
    { seed: 99 },
    { costStatus: 'known' },
  ])
    assert.equal(
      generationRecordSchema.safeParse({ ...record, ...change }).success,
      false,
    )
})
test('import provenance and workflow position cannot pretend to be execution records', () => {
  const imported = {
    id,
    projectId: id,
    source: 'file-import',
    contentHash: fingerprint,
    importedAt: now,
    outputAssetVersionIds: [other],
    description: 'fixture',
  }
  assert.ok(importProvenanceSchema.safeParse(imported).success)
  assert.equal(generationRecordSchema.safeParse(imported).success, false)
  assert.equal(
    stepRunSchema.safeParse({
      id,
      projectId: id,
      workflowRunId: other,
      stepKey: 'render',
      state: 'running',
      taskIds: [],
      createdAt: now,
      updatedAt: now,
    }).success,
    false,
  )
})
