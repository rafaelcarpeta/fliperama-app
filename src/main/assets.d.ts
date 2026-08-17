declare module "*.png" {
  const src: string
  export default src
}

declare module "*.css?raw" {
  const css: string
  export default css
}
