import OpenAI, { toFile } from "openai";

/**
 * transcribeAudio — Shared Whisper STT utility.
 * Downloads audio as a Buffer and calls OpenAI Whisper-1.
 * Returns the transcribed text, or null on error / missing API key.
 *
 * Works with any audio format Whisper supports:
 *   flac, m4a, mp3, mp4, mpeg, mpga, ogg, wav, webm
 */
export async function transcribeAudio(
  buffer: Buffer,
  filename: string,
  mimeType = "audio/ogg",
): Promise<string | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.warn("[transcribeAudio] OPENAI_API_KEY not set — skipping voice transcription");
    return null;
  }
  if (!buffer.length) {
    console.warn("[transcribeAudio] Empty audio buffer — skipping");
    return null;
  }

  try {
    const openai = new OpenAI({ apiKey });
    const file   = await toFile(buffer, filename, { type: mimeType });

    const result = await openai.audio.transcriptions.create({
      file,
      model:    "whisper-1",
      response_format: "text",
    });

    const text = typeof result === "string" ? result.trim() : (result as { text?: string }).text?.trim() ?? null;
    console.log(`[transcribeAudio] ✅ ${buffer.length}B → "${(text ?? "").slice(0, 80)}"`);
    return text || null;
  } catch (err) {
    console.error("[transcribeAudio] Whisper error:", String(err));
    return null;
  }
}
