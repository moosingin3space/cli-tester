/**
 * Runtime configuration for the agent loop.
 *
 * Only the *discover* phase needs an LLM (and therefore an API key); *test* is a
 * deterministic verifier and runs without one. {@link loadConfig} reflects that
 * with `skipApiKey`.
 */

function positiveInt(name: string, raw: string): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`${name} must be a positive integer, got: ${JSON.stringify(raw)}`);
  }
  return n;
}

function positiveNumber(name: string, raw: string): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`${name} must be a positive number, got: ${JSON.stringify(raw)}`);
  }
  return n;
}

export interface AgentConfig {
  apiKey: string;
  model: string;
  /** Hard cap on agent turns, so a discovery run terminates. */
  maxSteps: number;
  /** Hard cap on spend (USD), so a discovery run terminates. */
  maxCost: number;
}

const DEFAULTS: AgentConfig = {
  apiKey: "",
  model: "anthropic/claude-haiku-4.5",
  maxSteps: 40,
  maxCost: 1.0,
};

export function loadConfig(
  overrides: Partial<AgentConfig> = {},
  opts?: { skipApiKey?: boolean },
): AgentConfig {
  const config = { ...DEFAULTS };

  if (process.env.OPENROUTER_API_KEY) config.apiKey = process.env.OPENROUTER_API_KEY;
  if (process.env.AGENT_MODEL) config.model = process.env.AGENT_MODEL;
  if (process.env.AGENT_MAX_STEPS) config.maxSteps = positiveInt("AGENT_MAX_STEPS", process.env.AGENT_MAX_STEPS);
  if (process.env.AGENT_MAX_COST) config.maxCost = positiveNumber("AGENT_MAX_COST", process.env.AGENT_MAX_COST);

  Object.assign(config, overrides);

  if (!config.apiKey && !opts?.skipApiKey) {
    throw new Error("OPENROUTER_API_KEY is required for `discover`. Set it in the environment or a .env file.");
  }
  return config;
}
