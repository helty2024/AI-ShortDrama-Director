import { PackyImage25Adapter } from '../tools/adapters/packy-image-25.js'
import type { CapabilityInput } from '../../../src/shared/capabilities/index.js'
import type { ToolCallContext } from '../../../src/shared/tools.js'
import type { ImageCapability } from '../tools/adapters/image-api.js'
import { ImageHttpTransport } from '../tools/adapters/image-http.js'
import type { StoredAIService } from './ai-services.js'
import type { NativeProductionGate } from './native-production.js'
import type { CredentialStore } from '../video/credentials.js'
import { generationEstimateSchema } from '../../../src/shared/generation.js'

export class ProductionPackyAdapter extends PackyImage25Adapter {
  private readonly service: StoredAIService
  private readonly gate: NativeProductionGate
  constructor(service: StoredAIService, credentials: CredentialStore, gate: NativeProductionGate) {
    super({adapter:'packy-image-25',toolId:'packy.image-25',displayName:'PackyAPI · GPT Image 2.5 Sunburst',modelId:'gpt-image-2.5-sunburst',credentialRef:service.credentialRef,tokenGroup:'image',currency:'USD'},
      async()=>credentials.get(service.credentialRef!),new ImageHttpTransport({timeoutMs:180000}),{
        consume:async(cap,input,context)=>{if(input.count!==1)throw new Error('One output per confirmed request required');await gate.consume(service,cap,context)},
      })
    this.service=service;this.gate=gate
  }
  override async validate<C extends ImageCapability>(cap:C,input:CapabilityInput<C>,ctx:ToolCallContext,signal:AbortSignal) {
    const result=await super.validate(cap,input,ctx,signal)
    if(await this.gate.available(this.service,cap))return result
    return {...result,valid:false,issues:[{code:'tool-unavailable' as const,field:null,message:'请先明确授权此图像能力的单次真实测试；未通过验证前不能批量生产'}]}
  }
  override async estimate<C extends ImageCapability>(cap:C,input:CapabilityInput<C>,ctx:ToolCallContext,signal:AbortSignal) {
    const estimate=await super.estimate(cap,input,ctx,signal)
    return generationEstimateSchema.parse({...estimate,cost:{status:'unknown',reason:'not-quoted'},basis:'Packy current production price not independently quoted; historical USD 0.4000 is not a current guaranteed charge. Explicit unknown-cost authorization required.'})
  }
}
