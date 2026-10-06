// Optional, one-time asset generation. The running app never calls an AI service.
// Uses the Replit-managed OpenAI integration; never print its credentials.
import { mkdir, writeFile } from 'node:fs/promises';
const base = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
const key = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
if (!base || !key) throw new Error('Replit OpenAI integration is not configured.');
const response = await fetch(`${base.replace(/\/$/, '')}/chat/completions`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    model: 'gpt-audio',
    modalities: ['text', 'audio'],
    audio: { voice: 'shimmer', format: 'mp3' },
    messages: [
      { role: 'system', content: 'Read only the exact Japanese phrase provided, once. Use a warm, cheerful, gentle character voice with clear Japanese pronunciation and a natural questioning intonation. No introduction, explanation, music, or sound effects.' },
      { role: 'user', content: 'This is a voice acting task, not a question to answer. Speak exactly the following five Japanese words/syllables and nothing else, in a cheerful gentle questioning tone: 「これはなーに？」. Do not answer the question, do not add any words. Your entire spoken output must be: これはなーに？' },
    ],
  }),
});
if (!response.ok) throw new Error(`Guide audio generation failed (HTTP ${response.status}).`);
const result = await response.json();
const audio = result.choices?.[0]?.message?.audio;
if (!audio?.data) throw new Error('No audio returned.');
const transcript = (audio.transcript ?? '').replace(/[\s「」。？！!?、]/g, '');
if (!['これはなーに', 'これは何', 'これはなに', 'これは何ー'].includes(transcript)) {
  throw new Error('Generated guide did not match the required phrase. Asset not replaced.');
}
const destination = new URL('../public/assets/audio/voice_what_is_this.mp3', import.meta.url);
await mkdir(new URL('.', destination), { recursive: true });
await writeFile(destination, Buffer.from(audio.data, 'base64'));
console.log('Guide MP3 saved. Transcript:', audio.transcript);
