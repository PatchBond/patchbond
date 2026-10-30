import { createContext, useContext } from "react";
import type { AppConfig } from "./api";

export const ConfigContext = createContext<AppConfig | null>(null);

export function useConfig(): AppConfig {
  const c = useContext(ConfigContext);
  if (!c) throw new Error("useConfig outside ConfigContext");
  return c;
}

/**
 * Where maintainers install the GitHub App — known only once the operator has created it (the
 * server reports it). Until then, send people to the maintainer page, which explains setup.
 */
export function installUrl(cfg: AppConfig): { href: string; external: boolean } {
  return cfg.github?.app_url ? { href: `${cfg.github.app_url}/installations/select_target`, external: true } : { href: "/dashboard", external: false };
}
export const GITHUB_ORG_URL = "https://github.com/PatchBond";
