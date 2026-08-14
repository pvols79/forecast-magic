import globals from "globals";
import pluginJs from "@eslint/js";
import pluginReactConfig from "eslint-plugin-react/configs/recommended.js";

export default [
  {
    ignores: ["dist/**", "node_modules/**"]
  },
  {
    languageOptions: {
      globals: globals.browser
    }
  },
  {
    files: ["vite.config.js", "eslint.config.js", "server/**/*.js"],
    languageOptions: {
      globals: globals.node
    }
  },
  pluginJs.configs.recommended,
  pluginReactConfig,
];
