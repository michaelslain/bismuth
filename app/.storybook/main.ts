import type { StorybookConfig } from "storybook-solidjs-vite";

/**
 * Storybook for the Bismuth `app/src/ui/` Solid.js component library.
 *
 * Framework: `storybook-solidjs-vite` (community Solid renderer + Storybook's Vite
 * builder). NOTE: this package has NO Storybook-8 build — it starts at 9.0.0 — so we
 * run Storybook 9. `@storybook/addon-essentials` does not exist for SB9 either (its
 * features — controls / actions / viewport / backgrounds / docs — are baked into core),
 * so no addons are needed for the catalog. See `.storybook/README.md`.
 */
const config: StorybookConfig = {
  framework: "storybook-solidjs-vite",
  // Stories are colocated next to the components they document.
  stories: ["../src/ui/**/*.stories.@(ts|tsx)"],
  addons: [],
};

export default config;
