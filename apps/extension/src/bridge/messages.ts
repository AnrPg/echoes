// zod checks for bridge replies on the isolated side. The page can post look-alike messages, so every reply is
// validated before use. (The page is chatgpt.com itself, the source of the data anyway; validation is about not
// crashing on garbage, not about trust.)

import { z } from 'zod';
import { BRIDGE_CHANNEL, type BridgeReply, type LearnedState } from './protocol';

const QueryTemplateZ = z.array(z.tuple([z.string(), z.string()]));

export const LearnedStateZ: z.ZodType<LearnedState> = z.object({
  authSeen: z.boolean(),
  templates: z.partialRecord(z.enum(['conversation', 'messages', 'versions', 'projectSidebar', 'projectChats', 'fileDownload', 'fileContent']), QueryTemplateZ),
  chatListVariants: z.array(QueryTemplateZ),
}) as z.ZodType<LearnedState>;

const base = { channel: z.literal(BRIDGE_CHANNEL), dir: z.literal('from-page') };

export const BridgeReplyZ: z.ZodType<BridgeReply> = z.discriminatedUnion('op', [
  z.object({ ...base, id: z.string(), op: z.literal('fetch'), status: z.number().int(), headers: z.record(z.string(), z.string()), body: z.string() }),
  z.object({ ...base, id: z.string(), op: z.literal('state'), state: LearnedStateZ }),
  z.object({ ...base, id: z.string(), op: z.literal('error'), message: z.string() }),
  z.object({ ...base, op: z.literal('branch'), t: z.number(), request: z.unknown(), response: z.unknown() }),
]) as z.ZodType<BridgeReply>;

/** What an extension page sends over the port to the content script. */
export const PortRequestZ = z.discriminatedUnion('op', [
  z.object({ id: z.string(), op: z.literal('fetch'), url: z.string(), binary: z.boolean().optional() }),
  z.object({ id: z.string(), op: z.literal('state') }),
]);
export type PortRequest = z.infer<typeof PortRequestZ>;

/** A "Branch in new chat" seen by the monitor, sent from the content script to the service worker. */
export const BranchMessageZ = z.object({ type: z.literal('echoes:branch'), t: z.number(), request: z.unknown(), response: z.unknown() });
export type BranchMessage = z.infer<typeof BranchMessageZ>;
