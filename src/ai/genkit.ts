import {genkit} from 'genkit';
import {googleAI} from '@genkit-ai/google-genai';

// Flash-Lite is enough for structured extraction/summarization tasks and is the
// cheapest Gemini tier. Override per-deployment via GEMINI_MODEL if needed
// (e.g. GEMINI_MODEL=googleai/gemini-2.0-flash).
export const ai = genkit({
  plugins: [googleAI()],
  model: process.env.GEMINI_MODEL || 'googleai/gemini-2.5-flash-lite',
});
