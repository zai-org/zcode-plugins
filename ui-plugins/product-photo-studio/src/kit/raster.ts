import jpeg from "jpeg-js";
import { PNG } from "pngjs";
import { KitError } from "./workspace.ts";

/** RGBA 8 位图像。 */
export interface Raster {
  width: number;
  height: number;
  data: Uint8ClampedArray | Uint8Array;
}

export function createRaster(width: number, height: number, fill?: [number, number, number, number]): Raster {
  const data = new Uint8ClampedArray(width * height * 4);
  if (fill && (fill[0] || fill[1] || fill[2] || fill[3])) for (let i = 0; i < data.length; i += 4) data.set(fill, i);
  return { width, height, data };
}

/** JPEG 的 EXIF 方向（1–8），没有则为 1。 */
export function jpegOrientation(bytes: Uint8Array): number {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return 1;
  let offset = 2;
  while (offset + 4 < bytes.length) {
    if (bytes[offset] !== 0xff) return 1;
    const marker = bytes[offset + 1];
    const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
    if (marker === 0xe1 && bytes[offset + 4] === 0x45 && bytes[offset + 5] === 0x78 && bytes[offset + 6] === 0x69 && bytes[offset + 7] === 0x66) {
      const tiff = offset + 10;
      const little = bytes[tiff] === 0x49;
      const u16 = (at: number) => (little ? bytes[at] | (bytes[at + 1] << 8) : (bytes[at] << 8) | bytes[at + 1]);
      const u32 = (at: number) => (little ? (bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16)) + bytes[at + 3] * 16777216 : bytes[at] * 16777216 + ((bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]));
      const ifd = tiff + u32(tiff + 4);
      const count = u16(ifd);
      for (let i = 0; i < count; i++) {
        const entry = ifd + 2 + i * 12;
        if (entry + 12 > bytes.length) break;
        if (u16(entry) === 0x0112) return u16(entry + 8) || 1;
      }
      return 1;
    }
    if (marker === 0xda) return 1;
    offset += 2 + length;
  }
  return 1;
}

function orient(image: Raster, orientation: number): Raster {
  if (orientation <= 1 || orientation > 8) return image;
  const { width: w, height: h, data } = image;
  const swap = orientation >= 5;
  const out = createRaster(swap ? h : w, swap ? w : h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let nx = x;
      let ny = y;
      switch (orientation) {
        case 2: nx = w - 1 - x; break;
        case 3: nx = w - 1 - x; ny = h - 1 - y; break;
        case 4: ny = h - 1 - y; break;
        case 5: nx = y; ny = x; break;
        case 6: nx = h - 1 - y; ny = x; break;
        case 7: nx = h - 1 - y; ny = w - 1 - x; break;
        case 8: nx = y; ny = w - 1 - x; break;
      }
      const s = (y * w + x) * 4;
      const d = (ny * out.width + nx) * 4;
      out.data[d] = data[s];
      out.data[d + 1] = data[s + 1];
      out.data[d + 2] = data[s + 2];
      out.data[d + 3] = data[s + 3];
    }
  return out;
}

export function decodeImage(bytes: Uint8Array, name = "image"): Raster {
  try {
    if (bytes[0] === 0x89 && bytes[1] === 0x50) {
      const png = PNG.sync.read(Buffer.from(bytes));
      return { width: png.width, height: png.height, data: new Uint8ClampedArray(png.data.buffer, png.data.byteOffset, png.data.length) };
    }
    if (bytes[0] === 0xff && bytes[1] === 0xd8) {
      const image = jpeg.decode(bytes, { useTArray: true, formatAsRGBA: true, maxMemoryUsageInMB: 1024, maxResolutionInMP: 200 });
      return orient({ width: image.width, height: image.height, data: new Uint8ClampedArray(image.data.buffer) }, jpegOrientation(bytes));
    }
  } catch (error) {
    throw new KitError("bad_image", `Cannot decode ${name}: ${error instanceof Error ? error.message : error}`);
  }
  throw new KitError("unsupported_image", `${name}: only PNG and JPEG are supported (convert WebP/HEIC first).`);
}

export function encodePng(image: Raster): Buffer {
  const png = new PNG({ width: image.width, height: image.height });
  png.data = Buffer.from(image.data.buffer, image.data.byteOffset, image.data.length);
  return PNG.sync.write(png, { colorType: 6 });
}

/** JPEG 不支持透明：先与背景色合成。 */
export function encodeJpeg(image: Raster, quality = 90, background: [number, number, number] = [255, 255, 255]): Buffer {
  const data = Buffer.alloc(image.width * image.height * 4);
  for (let i = 0; i < data.length; i += 4) {
    const a = image.data[i + 3] / 255;
    data[i] = Math.round(image.data[i] * a + background[0] * (1 - a));
    data[i + 1] = Math.round(image.data[i + 1] * a + background[1] * (1 - a));
    data[i + 2] = Math.round(image.data[i + 2] * a + background[2] * (1 - a));
    data[i + 3] = 255;
  }
  return jpeg.encode({ width: image.width, height: image.height, data }, quality).data;
}

/** 缩放：缩小用区域平均（预乘 alpha，避免透明边发黑），放大用双线性。 */
export function resize(image: Raster, width: number, height: number): Raster {
  width = Math.max(1, Math.round(width));
  height = Math.max(1, Math.round(height));
  if (width === image.width && height === image.height) return image;
  const out = createRaster(width, height);
  const sx = image.width / width;
  const sy = image.height / height;
  const src = image.data;
  if (sx >= 1 && sy >= 1) {
    for (let y = 0; y < height; y++) {
      const y0 = y * sy;
      const y1 = Math.min(image.height, (y + 1) * sy);
      for (let x = 0; x < width; x++) {
        const x0 = x * sx;
        const x1 = Math.min(image.width, (x + 1) * sx);
        let r = 0, g = 0, b = 0, a = 0, total = 0;
        for (let yy = Math.floor(y0); yy < Math.ceil(y1); yy++) {
          const wy = Math.min(yy + 1, y1) - Math.max(yy, y0);
          for (let xx = Math.floor(x0); xx < Math.ceil(x1); xx++) {
            const wgt = wy * (Math.min(xx + 1, x1) - Math.max(xx, x0));
            const i = (yy * image.width + xx) * 4;
            const alpha = src[i + 3] * wgt;
            r += src[i] * alpha;
            g += src[i + 1] * alpha;
            b += src[i + 2] * alpha;
            a += alpha;
            total += wgt;
          }
        }
        const o = (y * width + x) * 4;
        if (a > 0) {
          out.data[o] = r / a;
          out.data[o + 1] = g / a;
          out.data[o + 2] = b / a;
        }
        out.data[o + 3] = a / total;
      }
    }
    return out;
  }
  for (let y = 0; y < height; y++) {
    const fy = Math.min(image.height - 1, Math.max(0, (y + 0.5) * sy - 0.5));
    const y0 = Math.floor(fy);
    const y1 = Math.min(image.height - 1, y0 + 1);
    const ty = fy - y0;
    for (let x = 0; x < width; x++) {
      const fx = Math.min(image.width - 1, Math.max(0, (x + 0.5) * sx - 0.5));
      const x0 = Math.floor(fx);
      const x1 = Math.min(image.width - 1, x0 + 1);
      const tx = fx - x0;
      const o = (y * width + x) * 4;
      const i00 = (y0 * image.width + x0) * 4, i10 = (y0 * image.width + x1) * 4, i01 = (y1 * image.width + x0) * 4, i11 = (y1 * image.width + x1) * 4;
      const w00 = (1 - tx) * (1 - ty) * src[i00 + 3], w10 = tx * (1 - ty) * src[i10 + 3], w01 = (1 - tx) * ty * src[i01 + 3], w11 = tx * ty * src[i11 + 3];
      const a = w00 + w10 + w01 + w11;
      if (a > 0) for (let c = 0; c < 3; c++) out.data[o + c] = (src[i00 + c] * w00 + src[i10 + c] * w10 + src[i01 + c] * w01 + src[i11 + c] * w11) / a;
      out.data[o + 3] = a;
    }
  }
  return out;
}

/** 等比缩小到最长边不超过 max。 */
export function fitWithin(image: Raster, max: number): Raster {
  const scale = Math.min(1, max / Math.max(image.width, image.height));
  return scale < 1 ? resize(image, image.width * scale, image.height * scale) : image;
}

/** 单通道盒式模糊（3 次近似高斯）。 */
export function blurChannel(values: Float32Array, width: number, height: number, radius: number, passes = 3): Float32Array {
  const r = Math.max(0, Math.round(radius));
  if (!r) return values;
  let src = values;
  let tmp = new Float32Array(values.length);
  for (let pass = 0; pass < passes; pass++) {
    for (let y = 0; y < height; y++) {
      let sum = 0;
      const row = y * width;
      for (let x = -r; x <= r; x++) sum += src[row + Math.min(width - 1, Math.max(0, x))];
      for (let x = 0; x < width; x++) {
        tmp[row + x] = sum / (2 * r + 1);
        sum += src[row + Math.min(width - 1, x + r + 1)] - src[row + Math.max(0, x - r)];
      }
    }
    const out = new Float32Array(values.length);
    for (let x = 0; x < width; x++) {
      let sum = 0;
      for (let y = -r; y <= r; y++) sum += tmp[Math.min(height - 1, Math.max(0, y)) * width + x];
      for (let y = 0; y < height; y++) {
        out[y * width + x] = sum / (2 * r + 1);
        sum += tmp[Math.min(height - 1, y + r + 1) * width + x] - tmp[Math.max(0, y - r) * width + x];
      }
    }
    src = out;
  }
  tmp = new Float32Array(0);
  return src;
}

export function parseColor(color: string | undefined, fallback: [number, number, number] = [255, 255, 255]): [number, number, number] {
  const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec((color ?? "").trim());
  if (!match) return fallback;
  const hex = match[1].length === 3 ? [...match[1]].map((c) => c + c).join("") : match[1];
  return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];
}

/** 把 src 按 alpha 叠到 dst 的 (dx, dy) 位置。 */
export function drawOver(dst: Raster, src: Raster, dx: number, dy: number, opacity = 1) {
  for (let y = 0; y < src.height; y++) {
    const ty = y + dy;
    if (ty < 0 || ty >= dst.height) continue;
    for (let x = 0; x < src.width; x++) {
      const tx = x + dx;
      if (tx < 0 || tx >= dst.width) continue;
      const s = (y * src.width + x) * 4;
      const a = (src.data[s + 3] / 255) * opacity;
      if (a <= 0) continue;
      const d = (ty * dst.width + tx) * 4;
      const da = dst.data[d + 3] / 255;
      const oa = a + da * (1 - a);
      for (let c = 0; c < 3; c++) dst.data[d + c] = (src.data[s + c] * a + dst.data[d + c] * da * (1 - a)) / oa;
      dst.data[d + 3] = oa * 255;
    }
  }
}
