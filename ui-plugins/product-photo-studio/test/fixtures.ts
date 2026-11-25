import { createRaster, encodeJpeg, encodePng } from "../src/kit/raster.ts";

/** 灰色渐变背景上的一个红色“商品”（圆角矩形 + 白色标签），偏左上放置。 */
export function gradientProduct(): Buffer {
  const w = 900, h = 700;
  const image = createRaster(w, h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const g = 235 - Math.round((y / h) * 25);
      image.data.set([g, g, g + 2, 255], i);
      const inBody = x > 150 && x < 450 && y > 120 && y < 560 && !((x < 180 || x > 420) && (y < 150 || y > 530));
      if (inBody) {
        const label = x > 220 && x < 380 && y > 280 && y < 400;
        image.data.set(label ? [250, 250, 250, 255] : [200, 30, 40, 255], i);
      }
    }
  return encodeJpeg(image, 92);
}

/** 已抠好的透明 PNG：一个蓝色圆。 */
export function cutoutPng(): Buffer {
  const w = 500, h = 400;
  const image = createRaster(w, h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) if ((x - 300) ** 2 + (y - 200) ** 2 < 120 ** 2) image.data.set([30, 80, 200, 255], (y * w + x) * 4);
  return encodePng(image);
}
