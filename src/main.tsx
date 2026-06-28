import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { initGlobalErrorLogging } from "./components/ErrorBoundary";
import { initSentry } from "./lib/observability";

// Observability (Sentry) — no-op zonder VITE_SENTRY_DSN. Vóór de window-listeners
// zodat Sentry's eigen global handlers de window-errors oppakken; client_errors blijft
// via initGlobalErrorLogging de eigen, RLS-beschermde bron.
initSentry();
// Initialize global error logging
initGlobalErrorLogging();

createRoot(document.getElementById("root")!).render(<App />);
