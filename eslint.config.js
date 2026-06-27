import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", "coverage"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": [
        "warn",
        {
          allowConstantExport: true,
          allowExportNames: [
            "badgeVariants",
            "buttonVariants",
            "initGlobalErrorLogging",
            "navigationMenuTriggerStyle",
            "toast",
            "toggleVariants",
            "useAuth",
            "useClientPortal",
            "useFormField",
            "useHasRole",
            "usePortal",
            "useRecentItems",
            "useSidebar",
            "useSuperAdmin",
          ],
        },
      ],
      "@typescript-eslint/no-unused-vars": "off",
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
  {
    // Data-laag-guard (Track B). Alleen src/ — NIET supabase/functions/ (edge functions
    // kunnen @/lib/db niet importeren en hebben hun eigen { data, error }-patroon). Flagt
    // het exacte boilerplate-teken `const { data, error } = await supabase.from(...)` zodat
    // het via unwrap()/unwrapList() gaat. Bewust 'warn': blokkeert CI niet, ruimt de
    // long-tail incrementeel op. Matcht GEEN storage/auth/rpc (geen supabase.from-root) en
    // GEEN intentional-swallow `const { data } = ...` (geen error-binding). Legitieme
    // uitzondering: // eslint-disable-next-line no-restricted-syntax + één-regel-reden.
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-syntax": [
        "warn",
        {
          selector:
            "VariableDeclarator[id.type='ObjectPattern']:has(Property[key.name='error']) > AwaitExpression:has(MemberExpression[object.name='supabase'][property.name='from'])",
          message:
            "Data-laag: gebruik unwrap()/unwrapList() uit @/lib/db i.p.v. `const { data, error } = await supabase.from(...)`. Zie docs/data-layer-conventions.md.",
        },
      ],
    },
  },
);
