'use server';
/**
 * @fileOverview Authenticated server action for voice transcription.
 * The implementation lives in src/ai/logic/voice-transcribe.ts; the bot webhook
 * calls that core directly (it authenticates requests via the webhook secret).
 */

import { requireAuth } from '@/lib/server-auth';
import { enforceRateLimit } from '@/lib/rate-limit';
import { transcribeVoiceCore } from '@/ai/logic/voice-transcribe';

export interface VoiceTranscribeInput {
  audioBase64: string;
  mimeType?: string;
}
export interface VoiceTranscribeOutput {
  text: string;
}

export async function transcribeVoice(
  input: VoiceTranscribeInput,
  idToken: string
): Promise<VoiceTranscribeOutput> {
  const uid = await requireAuth(idToken);
  await enforceRateLimit(uid);
  return transcribeVoiceCore({
    audioBase64: input.audioBase64,
    mimeType: input.mimeType || 'audio/ogg',
  });
}
