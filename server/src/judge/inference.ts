import type { Config } from "../config";
import { MockInference, NearAiInference, type Inference } from "./nearai";

export function makeInference(cfg: Config): Inference {
  return cfg.judge.mode === "nearai"
    ? new NearAiInference(cfg.judge.model, cfg.judge.apiKey())
    : new MockInference(cfg.judge.mockKey);
}
