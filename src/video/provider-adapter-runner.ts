import { submitSeedanceDirectNative, pollSeedanceDirectNative, cancelSeedanceDirectNative } from './native-seedance.js';
import { submitVeoUseApiNative, pollVeoUseApiNative } from './native-veo.js';
import { submitRunwayUseApiNative, pollRunwayUseApiNative, cancelRunwayUseApiNative } from './native-runway.js';
import type { ProviderRouteId } from './provider-platform/types.js';
import type { VideoExecutionCancelResult, VideoExecutionPayload, VideoExecutionPollResult } from './types.js';

export async function runBuiltinProviderAdapter(
  route: ProviderRouteId,
  input: Record<string, unknown>,
  options: {
    env?: NodeJS.ProcessEnv;
  } = {},
): Promise<unknown> {
  if (route === 'seedance-direct') {
    if (input.action === 'poll') {
      return pollSeedanceDirectNative({
        outputDir: String(input.outputDir ?? ''),
        externalJobId: String(input.externalJobId ?? ''),
        workspaceRoot: String(input.workspaceRoot ?? ''),
      }, {
        env: options.env,
      }) as Promise<VideoExecutionPollResult>;
    }
    if (input.action === 'cancel') {
      return cancelSeedanceDirectNative({
        outputDir: String(input.outputDir ?? ''),
        externalJobId: String(input.externalJobId ?? ''),
        workspaceRoot: String(input.workspaceRoot ?? ''),
      }, {
        env: options.env,
      }) as Promise<VideoExecutionCancelResult>;
    }
    return submitSeedanceDirectNative(input as unknown as VideoExecutionPayload, {
      env: options.env,
    });
  }

  if (route === 'veo-useapi') {
    if (input.action === 'poll') {
      return pollVeoUseApiNative({
        outputDir: String(input.outputDir ?? ''),
        externalJobId: String(input.externalJobId ?? ''),
      }) as Promise<VideoExecutionPollResult>;
    }
    if (input.action === 'cancel') {
      return {
        status: 'unsupported',
        externalJobId: String(input.externalJobId ?? '') || null,
        issues: ['veo-useapi native transport does not support cancel.'],
        rawResult: null,
      } satisfies VideoExecutionCancelResult;
    }
    return submitVeoUseApiNative(input as unknown as VideoExecutionPayload, {
      env: options.env,
    });
  }

  if (route === 'runway-useapi') {
    if (input.action === 'poll') {
      return pollRunwayUseApiNative({
        outputDir: String(input.outputDir ?? ''),
        externalJobId: String(input.externalJobId ?? ''),
        workspaceRoot: String(input.workspaceRoot ?? ''),
      }, {
        env: options.env,
      }) as Promise<VideoExecutionPollResult>;
    }
    if (input.action === 'cancel') {
      return cancelRunwayUseApiNative({
        outputDir: String(input.outputDir ?? ''),
        externalJobId: String(input.externalJobId ?? ''),
        workspaceRoot: String(input.workspaceRoot ?? ''),
      }) as Promise<VideoExecutionCancelResult>;
    }
    return submitRunwayUseApiNative(input as unknown as VideoExecutionPayload, {
      env: options.env,
    });
  }

  throw new Error(`No native transport is implemented for ${route}.`);
}
