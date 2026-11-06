/* AI xatosi — qaysi provayder bo‘lishidan qat’i nazar bir xil kodlar: no_ai_key, network, http_NNN, refusal, max_tokens, too_many_turns, empty */
export class AiError extends Error { constructor(code, detail) { super(code); this.code = code; this.detail = detail; } }
