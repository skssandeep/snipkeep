/// <reference types="vite/client" />

// Vite's own client types cover `*.css` but not the `?inline` query form
// (import the file's text instead of injecting a <style> tag) — used by
// Drawer.tsx to carry popup.css into the Shadow DOM.
declare module '*.css?inline' {
  const css: string
  export default css
}
