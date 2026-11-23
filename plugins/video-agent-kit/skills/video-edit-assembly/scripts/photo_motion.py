#!/usr/bin/env python3
"""Render a still with subpixel zoom/pan; use --help for the command contract."""
import argparse
from fractions import Fraction
import hashlib
import json
import math
from pathlib import Path
import subprocess
import tempfile

from PIL import Image, ImageColor, ImageOps


def sha256(path):
    digest = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def prepare_canvas(source, size, fit='contain', background='#111111'):
    """Fit once, before animation. The canvas has twice the output dimensions."""
    with Image.open(source) as opened:
        if getattr(opened, 'n_frames', 1) != 1:
            raise ValueError('Input must be a single still image, not an animation.')
        photo = ImageOps.exif_transpose(opened).convert('RGBA')
    canvas = Image.new('RGB', size, ImageColor.getrgb(background))
    if fit == 'cover':
        fitted = ImageOps.fit(photo, size, method=Image.Resampling.LANCZOS)
    else:
        fitted = ImageOps.contain(photo, size, method=Image.Resampling.LANCZOS)
    canvas.paste(fitted, ((size[0]-fitted.width)//2, (size[1]-fitted.height)//2), fitted)
    return canvas


def motion_frame(canvas, size, progress, start_zoom, end_zoom,
                 start_x=.5, end_x=.5, start_y=.5, end_y=.5):
    """Inverse map each frame from the same canvas using floating coordinates."""
    zoom = start_zoom + (end_zoom-start_zoom) * progress
    x = start_x + (end_x-start_x) * progress
    y = start_y + (end_y-start_y) * progress
    # x/y select a fraction of the available crop: 0 = left/top, 1 = right/bottom.
    # Do not round crop origins or resize to a different integer size each frame.
    matrix = (1/zoom, 0, (canvas.width-canvas.width/zoom)*x,
              0, 1/zoom, (canvas.height-canvas.height/zoom)*y)
    frame = canvas.transform(canvas.size, Image.Transform.AFFINE, matrix,
                             resample=Image.Resampling.BICUBIC)
    return frame.resize(size, Image.Resampling.LANCZOS)


def render(source, output, *, width, height, duration, fps='30',
           start_zoom=1., end_zoom=1., start_x=.5, end_x=.5,
           start_y=.5, end_y=.5, fit='contain', background='#111111'):
    source = Path(source).resolve(); output = Path(output).resolve()
    sidecar = output.with_suffix('.photo_motion.json')
    if not source.is_file():
        raise ValueError(f'Input image does not exist: {source}')
    if output.suffix.lower() != '.mp4' or output == source:
        raise ValueError('Output must be a new .mp4 file, separate from the input.')
    if output.exists() or sidecar.exists():
        raise ValueError('Output or provenance file already exists; choose a new output name.')
    if width <= 0 or height <= 0 or width % 2 or height % 2:
        raise ValueError('Width and height must be positive even integers.')
    try:
        rate = Fraction(str(fps))
    except (ValueError, ZeroDivisionError) as error:
        raise ValueError('FPS must be a positive number or fraction, such as 30000/1001.') from error
    if rate <= 0 or not math.isfinite(duration) or duration <= 0:
        raise ValueError('FPS and duration must be positive and finite.')
    if any(not math.isfinite(z) or z < 1 for z in [start_zoom, end_zoom]):
        raise ValueError('Zoom endpoints must be finite and at least 1.')
    if any(not math.isfinite(p) or not 0 <= p <= 1
           for p in [start_x, end_x, start_y, end_y]):
        raise ValueError('Crop positions must be finite fractions between 0 and 1.')
    if fit not in ['contain', 'cover']:
        raise ValueError('Fit must be contain or cover.')
    frames = round(duration * rate)
    if frames < 1:
        raise ValueError('Duration is shorter than half a frame at this FPS.')
    moving = (start_zoom, start_x, start_y) != (end_zoom, end_x, end_y)
    if moving and frames < 2:
        raise ValueError('Motion needs at least two frames; use a still for a single frame.')
    source_hash = sha256(source)
    canvas = prepare_canvas(source, (width*2, height*2), fit, background)
    output.parent.mkdir(parents=True, exist_ok=True)
    parameters = dict(width=width, height=height, requested_duration_s=duration,
                      fps=str(rate), frame_count=frames, duration_s=float(frames/rate),
                      start_zoom=start_zoom, end_zoom=end_zoom, start_x=start_x,
                      end_x=end_x, start_y=start_y, end_y=end_y, fit=fit, background=background)
    with tempfile.TemporaryDirectory(prefix='.photo_motion_', dir=output.parent) as folder:
        temp = Path(folder)/'motion.mp4'; log = Path(folder)/'ffmpeg.log'
        cmd = ['ffmpeg', '-hide_banner', '-loglevel', 'error', '-nostdin',
               '-f', 'rawvideo', '-pixel_format', 'rgb24', '-video_size', f'{width}x{height}',
               '-framerate', str(rate), '-i', 'pipe:0', '-an', '-frames:v', str(frames),
               '-vf', 'setsar=1', '-c:v', 'libx264', '-preset', 'fast', '-crf', '18',
               '-pix_fmt', 'yuv420p', '-threads', '2', '-movflags', '+faststart', str(temp)]
        with log.open('wb') as errors:
            process = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.DEVNULL,
                                       stderr=errors)
            try:
                for i in range(frames):
                    frame = motion_frame(canvas, (width, height), i/max(frames-1, 1),
                                         start_zoom, end_zoom, start_x, end_x, start_y, end_y)
                    process.stdin.write(frame.tobytes())
                process.stdin.close()
                code = process.wait()
            except BrokenPipeError as error:
                process.wait()
                try:
                    process.stdin.close()
                except BrokenPipeError:
                    pass
                raise RuntimeError('Photo encoding failed: ' + log.read_text(errors='replace')[-2000:]) from error
            except BaseException:
                process.kill(); process.wait()
                try:
                    process.stdin.close()
                except BrokenPipeError:
                    pass
                raise
        if code:
            raise RuntimeError('Photo encoding failed: ' + log.read_text(errors='replace')[-2000:])
        if sha256(source) != source_hash:
            raise ValueError('Input changed during rendering; output was not published.')
        provenance = dict(source=str(source), source_sha256=source_hash,
                          output=str(output), output_sha256=sha256(temp),
                          method='fixed canvas; floating inverse affine; 2x sampling; Lanczos downsample',
                          script=str(Path(__file__).resolve()), script_sha256=sha256(__file__),
                          parameters=parameters)
        temp_report = Path(folder)/'motion.json'
        temp_report.write_text(json.dumps(provenance, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
        # Hard links publish complete files without overwriting another writer's output.
        output.hardlink_to(temp)
        try:
            sidecar.hardlink_to(temp_report)
        except BaseException:
            output.unlink()
            raise
    return provenance


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', required=True, type=Path, help='Single source photo or composed photo card')
    parser.add_argument('--output', required=True, type=Path, help='New .mp4 path; existing files are never replaced')
    parser.add_argument('--width', required=True, type=int)
    parser.add_argument('--height', required=True, type=int)
    parser.add_argument('--duration', required=True, type=float, help='Seconds, rounded to the nearest frame')
    parser.add_argument('--fps', default='30', help='Match the timeline, e.g. 30 or 30000/1001')
    parser.add_argument('--start-zoom', type=float, default=1.)
    parser.add_argument('--end-zoom', type=float, default=1.)
    for name in ['start-x', 'end-x', 'start-y', 'end-y']:
        parser.add_argument('--'+name, type=float, default=.5, help='Fraction of available crop, from 0 to 1')
    parser.add_argument('--fit', choices=['contain', 'cover'], default='contain')
    parser.add_argument('--background', default='#111111')
    args = vars(parser.parse_args()); args['source'] = args.pop('input')
    try:
        result = render(**args)
    except (ValueError, OSError, RuntimeError) as error:
        parser.exit(1, f'{error}\n')
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
