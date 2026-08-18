// heic-convert ships no types (plain CJS). The real call signature is asserted at the one
// import site (core/src/heic.ts), which casts this `any` to a narrow `HeicConvert` type — so
// the shape still lives in checked code rather than being lost here.
declare module 'heic-convert'
