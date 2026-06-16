/// <reference types="vite/client" />

// KaTeX's contrib extensions ship no type declarations. mhchem is a side-effect import
// (it registers \ce/\pu on the katex singleton — see editor/katexLoader.ts).
declare module "katex/contrib/mhchem";
