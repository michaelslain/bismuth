// Ambient override for katexCss.ts's `with { type: 'text' }` import of the KaTeX stylesheet.
// cli's tsconfig also includes app/src/vite-env.d.ts (for the exporter bridge), whose
// `vite/client` reference declares a wildcard `declare module '*.css' {}` (a CSS-Modules
// classes object) that would otherwise win and type the import as an empty module with no
// default export. This exact-specifier declaration takes precedence over that wildcard.
declare module 'katex/dist/katex.min.css' {
    const css: string
    export default css
}
