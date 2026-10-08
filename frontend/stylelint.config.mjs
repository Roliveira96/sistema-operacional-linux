// Color literals are forbidden everywhere except the design tokens file, so
// every component consumes semantic tokens and both themes stay in parity.
const colorFunctions = ["rgb", "rgba", "hsl", "hsla", "hwb", "lab", "lch", "oklab", "oklch", "color", "color-mix"];

/** @type {import("stylelint").Config} */
export const noColorLiteralsRules = {
  "color-no-hex": true,
  "color-named": "never",
  "function-disallowed-list": colorFunctions,
};

const config = {
  extends: ["stylelint-config-standard-scss"],
  rules: {
    ...noColorLiteralsRules,
    "selector-class-pattern": [
      "^[a-z][a-zA-Z0-9]*$",
      { message: "CSS Module class names must be camelCase" },
    ],
  },
  overrides: [
    {
      files: ["src/styles/_tokens.scss"],
      rules: { "color-no-hex": null, "color-named": null, "function-disallowed-list": null },
    },
  ],
};

export default config;
