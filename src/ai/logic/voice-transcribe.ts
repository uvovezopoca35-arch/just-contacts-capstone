/**
 * Core voice transcription. Not a server action — imported by the authed flow
 * wrapper (client path) and the bot webhook (server path).
 *
 * Uses Groq Whisper (whisper-large-v3-turbo) when GROQ_API_KEY is set — it is
 * cheaper and faster per audio minute than a multimodal LLM. Falls back to
 * Gemini multimodal transcription otherwise.
 */
import { ai } from '@/ai/genkit';

export interface VoiceTranscribeInput {
  audioBase64: string;
  mimeType: string;
}

async function transcribeWithGroq(input: VoiceTranscribeInput): Promise<string | null> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return null;

  try {
    const buffer = Buffer.from(input.audioBase64, 'base64');
    const ext = input.mimeType.split('/').pop()?.split(';')[0] || 'ogg';
    const form = new FormData();
    form.append('file', new Blob([buffer], { type: input.mimeType }), `audio.${ext}`);
    form.append('model', 'whisper-large-v3-turbo');
    form.append('response_format', 'json');

    const res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });
    if (!res.ok) {
      console.warn('Groq transcription failed, falling back to Gemini:', res.status, await res.text().catch(() => ''));
      return null;
    }
    const data = await res.json();
    return typeof data.text === 'string' ? data.text.trim() : null;
  } catch (e) {
    console.warn('Groq transcription error, falling back to Gemini:', e);
    return null;
  }
}

async function transcribeWithGemini(input: VoiceTranscribeInput): Promise<string> {
  const result = await ai.generate({
    prompt: [
      {
        media: {
          url: `data:${input.mimeType};base64,${input.audioBase64}`,
        },
      },
      {
        text: 'Транскрибируй это голосовое сообщение. Верни ТОЛЬКО текст, который был произнесён. Не добавляй никаких пояснений, заголовков или форматирования. Если ничего не удалось распознать, верни пустую строку.',
      },
    ],
  });
  return result.text?.trim() || '';
}

export async function transcribeVoiceCore(input: VoiceTranscribeInput): Promise<{ text: string }> {
  try {
    const groqText = await transcribeWithGroq(input);
    if (groqText !== null) return { text: groqText };
    return { text: await transcribeWithGemini(input) };
  } catch (e) {
    console.error('Voice transcription error:', e);
    return { text: '' };
  }
}
