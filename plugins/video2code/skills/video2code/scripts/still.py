#!/usr/bin/env python3
"""still.py — 从视频（源录屏或自录 WebM/MP4 等）抽全分辨率静帧，可裁剪/放大。

用法:
  python3 still.py <video> <t1> [t2 ...] [--crop X,Y,W,H] [--scale N] [--out DIR] [--prefix P]

  t: 秒 (可小数)。--crop 源像素坐标; --scale 裁剪后放大倍数 (默认 1, 观察 logo/小元素用 2-3)。
  输出 <out>/<prefix>_<t>s.png (裁剪版自动带 _crop 后缀, 不覆盖同目录全帧),
  逐行打印落盘路径 (接着用 Read 查看)。
"""
from __future__ import annotations
import argparse
from pathlib import Path


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("video")
    ap.add_argument("times", nargs="+", type=float)
    ap.add_argument("--crop", default=None, help="X,Y,W,H (源像素)")
    ap.add_argument("--scale", type=float, default=1.0)
    ap.add_argument("--out", default="out/stills")
    ap.add_argument("--prefix", default="still")
    a = ap.parse_args()

    import cv2
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    crop = None
    if a.crop:
        x, y, w, h = (int(v) for v in a.crop.split(","))
        crop = (x, y, w, h)
    cap = cv2.VideoCapture(a.video)
    if not cap.isOpened():
        raise SystemExit(f"[ERROR] 打不开视频: {a.video}")
    for t in a.times:
        cap.set(cv2.CAP_PROP_POS_MSEC, t * 1000)
        ok, fr = cap.read()
        if not ok or fr is None:
            print(f"[WARN] t={t}s 抽帧失败 (超出时长?)")
            continue
        if crop:
            x, y, w, h = crop
            fh, fw = fr.shape[:2]
            x0, y0 = max(0, x), max(0, y)
            x1, y1 = min(fw, x + w), min(fh, y + h)
            if x1 <= x0 or y1 <= y0:
                print(f"[WARN] t={t}s 裁剪区域为空 (crop 超界?)")
                continue
            fr = fr[y0:y1, x0:x1]
        if a.scale != 1.0:
            fr = cv2.resize(fr, None, fx=a.scale, fy=a.scale,
                            interpolation=cv2.INTER_CUBIC if a.scale > 1 else cv2.INTER_AREA)
        # 裁剪版与全帧分名, 防止同 t 的 crop 输出覆盖之前抽的全帧
        # (实测: still_16.5s 被裁剪版顶掉, 后续测量差点用错帧)
        suffix = "_crop" if crop else ""
        p = out / f"{a.prefix}_{t:g}s{suffix}.png"
        cv2.imwrite(str(p), fr)
        print(p)
    cap.release()


if __name__ == "__main__":
    main()
