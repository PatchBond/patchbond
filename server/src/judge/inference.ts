import type { Config } from "../config";
import { MockInference, NearAiInference, type Inference } from "./nearai";

/** `strong` = the model that re-judges challenged verdicts (more expensive, used only when money is staked). */
export function makeInference(cfg: Config, strong = false): Inference {
  return cfg.judge.mode === "nearai"
    ? new NearAiInference(strong ? cfg.judge.strongModel : cfg.judge.model, cfg.judge.apiKey())
    : new MockInference(cfg.judge.mockKey);
}
