import type { Conversation } from '../model/schema.ts';
import { parseConversation } from '../model/validate.ts';

/**
 * Serialize a conversation as Echoes JSON (the published `conversation.v1` schema), pretty-printed with a trailing
 * newline. The input is validated first, so a file this writes always parses back with {@link parseConversation}.
 * Deterministic: key order follows the validated object, which follows the schema.
 *
 * @throws EchoesValidationError when the conversation is invalid.
 *
 * @example
 * ```ts
 * writeFile('chat.echoes.json', renderJson(conversation));
 * ```
 */
export function renderJson(conversation: Conversation): string {
  return JSON.stringify(parseConversation(conversation), null, 2) + '\n';
}
