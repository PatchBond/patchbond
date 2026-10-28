import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router";
import "./styles.css";
import { Shell } from "./components/Shell";
import { api } from "./lib/api";
import { useAsync } from "./lib/useAsync";
import { WalletProvider } from "./lib/wallet";
import { Home } from "./pages/Home";
import { Pay } from "./pages/Pay";
import { VerdictPage } from "./pages/Verdict";
import { RepoPage } from "./pages/Repo";
import { Agents } from "./pages/Agents";
import { NotFound } from "./pages/NotFound";
import { Notice, Spinner } from "./components/kit";
import { ConfigContext } from "./lib/config";

function App() {
  const { data: cfg, error } = useAsync(api.config, []);
  if (error) {
    return (
      <div className="mx-auto max-w-lg p-6 pt-24">
        <Notice tone="error" title="Can't reach the PatchBond server">
          {error}. Start it with <code>bun run --cwd server dev</code>, then reload.
        </Notice>
      </div>
    );
  }
  if (!cfg) {
    return (
      <div className="grid min-h-screen place-items-center text-muted-foreground">
        <Spinner />
      </div>
    );
  }
  return (
    <ConfigContext.Provider value={cfg}>
      <WalletProvider cfg={cfg}>
        <BrowserRouter>
          <Shell>
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/pay/:repoId/:number" element={<Pay />} />
              <Route path="/v/:id" element={<VerdictPage />} />
              <Route path="/r/:repoId" element={<RepoPage />} />
              <Route path="/agents" element={<Agents />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Shell>
        </BrowserRouter>
      </WalletProvider>
    </ConfigContext.Provider>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
