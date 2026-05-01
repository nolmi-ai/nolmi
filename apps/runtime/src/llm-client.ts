import type { LanguageModel } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createGroq } from "@ai-sdk/groq";
import { createOpenAI } from "@ai-sdk/openai";
import { createOllama } from "ollama-ai-provider-v2";
import type { TwinLlmConfig } from "./llm-config.js";

// ─── LLM CLIENT FACTORY ──────────────────────────────────────────────────────
//
// Liefert ein Vercel-AI-SDK-`LanguageModel` für die in `TwinLlmConfig`
// gewählte Provider/Modell-Kombi. Pro Provider die `create*`-Factory aus dem
// AI-SDK (statt der env-gebundenen Default-Singletons), damit der API-Key aus
// unserer Config kommt — nicht aus globalen ENV-Konventionen des SDK.
//
// Diese Funktion macht KEINE Netzwerk-Calls — nur Construction. Falsche
// Credentials oder offline-Provider fallen erst beim ersten generateText-Call
// auf, was wir genau so wollen (Boot bleibt stabil, der Twin-Service
// behandelt LLM-Fehler über audit.fail).

export function createLlmClient(config: TwinLlmConfig): LanguageModel {
  switch (config.provider) {
    case "openai": {
      const openai = createOpenAI({
        apiKey: config.apiKey,
        ...(config.baseUrl ? { baseURL: config.baseUrl } : {}),
      });
      return openai(config.model);
    }
    case "anthropic": {
      const anthropic = createAnthropic({
        apiKey: config.apiKey,
        ...(config.baseUrl ? { baseURL: config.baseUrl } : {}),
      });
      return anthropic(config.model);
    }
    case "google": {
      const google = createGoogleGenerativeAI({
        apiKey: config.apiKey,
        ...(config.baseUrl ? { baseURL: config.baseUrl } : {}),
      });
      return google(config.model);
    }
    case "groq": {
      const groq = createGroq({
        apiKey: config.apiKey,
        ...(config.baseUrl ? { baseURL: config.baseUrl } : {}),
      });
      return groq(config.model);
    }
    case "ollama": {
      // Ollama: lokal i.d.R. ohne Auth, Cloud / Self-hosted hinter Proxy mit
      // Bearer-Token. Default-Endpoint matched die Standard-Installation.
      const ollama = createOllama({
        baseURL: config.baseUrl ?? "http://localhost:11434/api",
        ...(config.apiKey
          ? { headers: { Authorization: `Bearer ${config.apiKey}` } }
          : {}),
      });
      return ollama(config.model);
    }
  }
}
