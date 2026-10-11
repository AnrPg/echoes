// Small builders for synthetic ChatGPT responses, shaped like the Phase 0 captures (see fixtures/ for a real one).
type Obj = Record<string, unknown>;

let clock = 1_700_000_000;
export function resetClock(): void {
  clock = 1_700_000_000;
}

export function msg(id: string, role: 'user' | 'assistant' | 'tool' | 'system', content: Obj | string, extra: Obj = {}): Obj {
  const { metadata, ...rest } = extra as { metadata?: Obj };
  return {
    id,
    author: { role, name: null, metadata: {} },
    create_time: (clock += 10),
    update_time: clock,
    content: typeof content === 'string' ? { content_type: 'text', parts: [content] } : content,
    recipient: 'all',
    channel: role === 'assistant' ? 'final' : null,
    weight: 1,
    status: 'finished_successfully',
    end_turn: role === 'assistant' ? true : null,
    metadata: { turn_exchange_id: `tx-${id}`, ...(metadata ?? {}) },
    ...rest,
  };
}

export function head(messages: Obj[], extra: Obj = {}): Obj {
  return {
    conversation_id: 'conv-1',
    title: 'Synthetic chat',
    create_time: 1_700_000_000.5,
    update_time: 1_700_000_999.25,
    current_node: messages.at(-1)?.id ?? 'none',
    default_model_slug: 'gpt-test',
    gizmo_id: null,
    gizmo_type: null,
    messages,
    page_info: { start_cursor: messages[0]?.id ?? null, end_cursor: messages.at(-1)?.id ?? null, has_previous_page: false, has_next_page: false },
    ...extra,
  };
}

export function older(messages: Obj[], hasPrevious = false): Obj {
  return {
    messages,
    page_info: { start_cursor: messages[0]?.id ?? null, end_cursor: messages.at(-1)?.id ?? null, has_previous_page: hasPrevious, has_next_page: true },
  };
}
