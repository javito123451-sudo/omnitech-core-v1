// Registro de canales. Un canal nuevo (SMS…) se registra aquí; el motor no cambia.
import type { ReviewChannel } from "@workspace/db";
import { emailProvider } from "./email";
import type { ChannelProvider } from "./types";
import { whatsappProvider } from "./whatsapp";

export type ProviderRegistry = Map<string, ChannelProvider>;

export function defaultRegistry(): ProviderRegistry {
  const m: ProviderRegistry = new Map();
  for (const p of [whatsappProvider(), emailProvider()]) m.set(p.channel, p);
  return m;
}
export const registry: ProviderRegistry = defaultRegistry();
export const getProvider = (channel: ReviewChannel | string, r: ProviderRegistry = registry) => r.get(channel) ?? null;
