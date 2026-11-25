#!/usr/bin/env python3
"""composite.py — 把源帧与部署截图拼成同尺度对照图 (Parity 判读的标准证据形态)。

用法:
  python3 composite.py <source_img> <replica_img> --out <path> [--mode h|v] [--label]
                       [--crop X,Y,W,H] [--scale N]

  两图缩放到同高 (h, 默认, 左源右复刻) 或同宽 (v, 上源下复刻) 后拼接;
  --label 在角上标 SRC/REP。打印落盘路径 (接着用 Read 判读, 量数对写进 verify)。

  --crop/--scale: 放大局部对照图 — 两侧同参裁剪后放大再拼。细线/小字/1-2px 特征
  在整幅合成图上目视判不了时用这个, 不要写逐像素测量脚本: 裁错了一眼可见 (显性失败),
  测量带画错了产出的是看似合法的错误数字 (隐性失败)。坐标基于源图坐标系;
  复刻图尺寸不同时按比例映射同一区域。
"""
from __future__ import annotations
import argparse
from pathlib import Path


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("source")
    ap.add_argument("replica")
    ap.add_argument("--out", required=True)
    ap.add_argument("--mode", choices=["h", "v"], default="h")
    ap.add_argument("--label", action="store_true")
    ap.add_argument("--crop", default=None,
                    help="X,Y,W,H (源图坐标系, 复刻图按比例映射同一区域)")
    ap.add_argument("--scale", type=float, default=1.0,
                    help="裁剪后放大倍数 (建议 2-3)")
    a = ap.parse_args()

    import cv2
    import numpy as np
    src = cv2.imread(a.source)
    rep = cv2.imread(a.replica)
    if src is None or rep is None:
        raise SystemExit(f"[ERROR] 读图失败: {a.source if src is None else a.replica}")

    if a.crop:
        try:
            x, y, w, h = (int(v) for v in a.crop.split(","))
        except ValueError:
            raise SystemExit(f"[ERROR] --crop 需要 X,Y,W,H 四个整数: {a.crop!r}")

        def crop_mapped(img):
            # 源图坐标系 → 本图坐标系按比例映射, 越界自动夹取
            fx = img.shape[1] / src_shape[1]
            fy = img.shape[0] / src_shape[0]
            x0 = max(0, int(x * fx)); y0 = max(0, int(y * fy))
            x1 = min(img.shape[1], int((x + w) * fx))
            y1 = min(img.shape[0], int((y + h) * fy))
            if x1 <= x0 or y1 <= y0:
                raise SystemExit(f"[ERROR] --crop 区域在图外: {a.crop}")
            return img[y0:y1, x0:x1]

        src_shape = src.shape
        src = crop_mapped(src)
        rep = crop_mapped(rep)

    if a.scale and a.scale != 1.0:
        src = cv2.resize(src, None, fx=a.scale, fy=a.scale,
                         interpolation=cv2.INTER_NEAREST)
        rep = cv2.resize(rep, None, fx=a.scale, fy=a.scale,
                         interpolation=cv2.INTER_NEAREST)

    def tag(img, text):
        cv2.rectangle(img, (0, 0), (86, 30), (0, 0, 0), -1)
        cv2.putText(img, text, (6, 22), cv2.FONT_HERSHEY_SIMPLEX, 0.7,
                    (255, 255, 255), 2, cv2.LINE_AA)
        return img

    if a.mode == "h":
        hh = min(src.shape[0], rep.shape[0])
        src = cv2.resize(src, (int(src.shape[1] * hh / src.shape[0]), hh))
        rep = cv2.resize(rep, (int(rep.shape[1] * hh / rep.shape[0]), hh))
        if a.label:
            src, rep = tag(src, "SRC"), tag(rep, "REP")
        gap = np.full((hh, 8, 3), 255, np.uint8)
        sheet = np.hstack([src, gap, rep])
    else:
        ww = min(src.shape[1], rep.shape[1])
        src = cv2.resize(src, (ww, int(src.shape[0] * ww / src.shape[1])))
        rep = cv2.resize(rep, (ww, int(rep.shape[0] * ww / rep.shape[1])))
        if a.label:
            src, rep = tag(src, "SRC"), tag(rep, "REP")
        gap = np.full((8, ww, 3), 255, np.uint8)
        sheet = np.vstack([src, gap, rep])

    out = Path(a.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(out), sheet)
    print(out)


if __name__ == "__main__":
    main()
