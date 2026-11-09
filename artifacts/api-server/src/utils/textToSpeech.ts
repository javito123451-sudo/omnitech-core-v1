// AVA Voice - Text to Speech para OmniTech Core
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY || "";
const ELEVENLABS_VOICE_ID = process.env.ELEVENLABS_VOICE_ID || "";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
function cleanTextForSpeech(text: string): string {
  let t = text.replace(/https?:\/\/\S+/g, " en el enlace de la descripción ").replace(/[*_#`>~|]/g, "").replace(/\n+/g, ". ").replace(/\s+/g, " ").trim();
  if (t.length > 600) { t = t.slice(0, 600); const lastDot = t.lastIndexOf("."); if (lastDot > 200) t = t.slice(0, lastDot + 1); }
  return t;
}
async function ttsElevenLabs(text: string): Promise<Buffer | null> {
  if (!ELEVENLABS_API_KEY || !ELEVENLABS_VOICE_ID) return null;
  try {
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE_ID}?output_format=opus_48000_64`, { method: "POST", headers: { "Content-Type": "application/json", "xi-api-key": ELEVENLABS_API_KEY }, body: JSON.stringify({ text, model_id: "eleven_multilingual_v2", voice_settings: { stability: 0.5, similarity_boost: 0.75, style: 0.2, use_speaker_boost: true } }) });
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch { return null; }
}
async function ttsOpenAI(text: string): Promise<Buffer | null> {
  if (!OPENAI_API_KEY) return null;
  try {
    const res = await fetch("https://api.openai.com/v1/audio/speech", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_API_KEY}` }, body: JSON.stringify({ model: "gpt-4o-mini-tts", voice: "nova", input: text, format: "opus" }) });
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch { return null; }
}
export async function textToSpeech(rawText: string): Promise<Buffer | null> {
  const text = cleanTextForSpeech(rawText);
  if (!text) return null;
  const el = await ttsElevenLabs(text);
  if (el) return el;
  const oai = await ttsOpenAI(text);
  if (oai) return oai;
  return null;
}
