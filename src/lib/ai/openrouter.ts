type ChatMessage = {
  role: "system" | "user";
  content: string;
};

type OpenRouterResponse = {
  choices?: Array<{ message?: { content?: string | null } }>;
  error?: { message?: string };
};

const OPENROUTER_CHAT_COMPLETIONS_URL =
  "https://openrouter.ai/api/v1/chat/completions";
const FALLBACK_MODEL = "nvidia/nemotron-3-ultra-550b-a55b:free";

type CompletionOptions = { maxTokens: number; temperature: number };

export function isOpenRouterConfigured(): boolean {
  return Boolean(
    process.env.OPENROUTER_API_KEY?.trim() &&
      process.env.OPENROUTER_MODEL?.trim(),
  );
}

async function completeWithModel(
  apiKey: string,
  model: string,
  messages: ChatMessage[],
  options: CompletionOptions,
): Promise<string> {
  const response = await fetch(OPENROUTER_CHAT_COMPLETIONS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "http://localhost:3000",
      "X-Title": "NoHell",
    },
    body: JSON.stringify({
      model,
      messages,
      max_tokens: options.maxTokens,
      temperature: options.temperature,
    }),
    signal: AbortSignal.timeout(45_000),
  });

  const payload = (await response.json().catch(() => ({}))) as OpenRouterResponse;
  if (!response.ok) {
    throw new Error(
      payload.error?.message || `OpenRouter request failed (${response.status})`,
    );
  }

  const content = payload.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new Error("Empty response from OpenRouter");
  }
  return content;
}

/** Server-only OpenRouter Chat Completions transport. */
export async function completeWithOpenRouter(
  messages: ChatMessage[],
  options: CompletionOptions,
): Promise<string> {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  const model = process.env.OPENROUTER_MODEL?.trim();
  if (!apiKey || !model) {
    throw new Error("OpenRouter is not configured");
  }

  let lastError: unknown;
  for (const candidateModel of [model, FALLBACK_MODEL]) {
    try {
      return await completeWithModel(apiKey, candidateModel, messages, options);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}
