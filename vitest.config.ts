import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react-swc";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    coverage: {
      // Informational only — no thresholds, not wired into the CI gate. A hard
      // threshold blocks unrelated PRs and invites coverage-gaming; we report and
      // ratchet later. Narrowed to lib + hooks (all:false) for a clean signal —
      // src/hooks/** is included now that useComplianceCheck has a real test behind it.
      provider: "v8",
      reporter: ["text", "html", "json-summary"],
      include: ["src/lib/**", "src/hooks/**"],
      all: false,
      exclude: [
        "src/integrations/supabase/types.ts",
        "src/components/ui/**",
        "src/test/**",
        "scripts/**",
        "**/*.d.ts",
        "**/*.test.{ts,tsx}",
      ],
    },
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});
