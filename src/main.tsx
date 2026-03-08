import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { initGlobalErrorLogging } from "./components/ErrorBoundary";

// Initialize global error logging
initGlobalErrorLogging();

createRoot(document.getElementById("root")!).render(<App />);
