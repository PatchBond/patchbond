import { createContext, useContext } from "react";
import type { AppConfig } from "./api";

export const ConfigContext = createContext<AppConfig | null>(null);

export function useConfig(): AppConfig {
  const c = useContext(ConfigContext);
  if (!c) throw new Error("useConfig outside ConfigContext");
  return c;
}

/** Where maintainers install the GitHub App. */
export const GITHUB_APP_URL = import.meta.env.VITE_GITHUB_APP_URL ?? "https://github.com/apps/patchbond";
export const GITHUB_ORG_URL = "https://github.com/PatchBond";
