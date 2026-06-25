import { config } from 'dotenv';
config();

import '@/ai/logic/contact-parsing.ts';
import '@/ai/logic/semantic-search.ts';
import '@/ai/logic/voice-transcribe.ts';
import '@/ai/logic/embedding.ts';
import '@/ai/flows/summarize-contact-flow.ts';
import '@/ai/flows/process-event-flow.ts';
import '@/ai/flows/update-contact-flow.ts';
import '@/ai/flows/ask-contact-flow.ts';
import '@/ai/flows/update-dossier-flow.ts';
