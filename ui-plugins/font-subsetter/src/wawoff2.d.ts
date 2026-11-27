declare module "wawoff2/compress.js" {
  const compress: (buf: Uint8Array) => Promise<Uint8Array>;
  export default compress;
}
declare module "wawoff2/decompress.js" {
  const decompress: (buf: Uint8Array) => Promise<Uint8Array>;
  export default decompress;
}
