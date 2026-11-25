# Video observation: methods to use as needed

The whole video and a local passage use the same sampling method; choose the time range and density by what is still uncertain. The parameters below are examples, not a procedure that must be run.

```bash
mkdir -p out/obs
ffprobe -v error -show_entries format=duration:stream=width,height -of json input/video.mp4
# One sample per second: stamp the source time first, then sample / scale / tile; more than one page keeps writing pages.
ffmpeg -nostdin -i input/video.mp4 -vf "drawtext=text='%{pts\\:hms}':x=8:y=8:fontcolor=white:box=1:boxcolor=black,fps=1,scale=480:-1,tile=4x4" out/obs/page-%03d.png
```

If ffmpeg has no drawtext, stamp the time on the samples with PIL. For a local passage put `trim=start=12:end=14` in front of the same kind of filters, raise `fps`, or narrow the region with `crop=w:h:x:y`. When exact pairing matters, read the decoded frames' actual PTS and keep the requested time apart from the time of the frame actually taken; a frame number is not source time.

After writing the output, look at the pages or frames you need with `view_image`. A gap between samples does not mean nothing changed; an overview can step over a short shot, and the last sample does not necessarily include the end of the video. Look again only where needed; there is no need to build a shot-by-shot ledger.

PIL's `Image.open(path).crop((x0,y0,x1,y1))` crops and `resize` enlarges. Pixels of the source are for observation only; delivered assets still follow the main task's exception for real natural scenes.
