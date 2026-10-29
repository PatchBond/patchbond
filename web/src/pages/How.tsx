// "How it works" as its own page: the flow, the price curve, the mechanisms and the fairness rules.

import { Fairness, HowItWorks, Mechanisms, Pricing } from "./Home";

export function How() {
  return (
    <>
      <HowItWorks />
      <Pricing />
      <Mechanisms />
      <Fairness />
    </>
  );
}
