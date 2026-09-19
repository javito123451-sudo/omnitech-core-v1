// ═══════════════════════════════════════════════════════════════════════════
//  Legacy bot → Agent adapter (contract only — NOT wired to anything)
//
//  Today's Telegram and WhatsApp bots have their own prompts and tool loops
//  (routes/telegram.ts, routes/whatsapp.ts). They keep running untouched.
//  When they are migrated, it will be gradually and behind this contract:
//
//      channel message → LegacyBotAdapter → runAgent()/confirmAgentAction()
//
//  The adapter is what translates a channel's identity (a phone number, a
//  chat id) and its constraints (customer-facing tool restriction) into the
//  RunActor / RunRequest the Agent Factory understands, and translates the
//  result back into the channel's reply. Nothing implements this interface
//  yet, and no existing code imports it: it only pins the shape.
// ═══════════════════════════════════════════════════════════════════════════

import type { AgentChannel } from "@workspace/db";
import type { RunResult } from "./agentRunner";

export interface LegacyChannelMessage {
  channel:    AgentChannel;
  orgId:      number;
  /** Phone number (WhatsApp) or chat id (Telegram): who is talking. */
  senderId:   string;
  text:       string;
}

export interface LegacyBotAdapter {
  channel: AgentChannel;
  /** Which agent answers this message (default agent of the channel/workspace), or null to keep the legacy bot. */
  pickAgent(message: LegacyChannelMessage): Promise<number | null>;
  /** Runs the agent for a channel message and returns the text to send back. */
  handle(message: LegacyChannelMessage, agentId: number): Promise<{ reply: string; run: RunResult }>;
}
