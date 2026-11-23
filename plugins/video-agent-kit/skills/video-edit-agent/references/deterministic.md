# Deterministic Processing with ffmpeg

Single-file operations whose result is fully determined by parameters. Each section gives the command shape, the parameters to decide, and what to check on the output. Commands are written one argument per token; follow the portability rules in [SKILL.md](../SKILL.md#shared-conventions) when running them. `in.mp4` / `out.mp4` stand for real paths.

Read `video_metadata` first: many choices below (stream copy, rotation, audio handling, even dimensions) depend on the source.

## Trim, Cut Out, Split

**Trim to a range.** Decide accuracy first.

- Frame-accurate (the default when cut points matter): re-encode.
  `ffmpeg -ss 12.5 -i in.mp4 -t 8 -c:v libx264 -crf 18 -preset medium -c:a aac -b:a 192k out.mp4`
- Fast, lossless, but starts on the preceding keyframe (can be seconds early, sometimes with a frozen first frame): `ffmpeg -ss 12.5 -i in.mp4 -t 8 -c copy -avoid_negative_ts make_zero out.mp4`. Use only when the user accepts approximate cuts or asks for no quality loss, and check the actual start.
- `-ss` before `-i` seeks the input; `-t` is a duration, `-to` an end time on the input clock. Times accept seconds or `HH:MM:SS.mmm`.

**Remove one or more middle ranges.** Trim the kept ranges to separate files with the accurate form, then join them (below). For many ranges, a single filter graph avoids intermediate files:

```
[0:v]select='not(between(t,30,45)+between(t,80,92))',setpts=N/FRAME_RATE/TB[v];
[0:a]aselect='not(between(t,30,45)+between(t,80,92))',asetpts=N/SR/TB[a]
```

Pass it with `-filter_complex_script graph.txt -map "[v]" -map "[a]"`. Check every join point with `video_observe` for a jump or audio click; add a short audio fade (`afade`) at joins when clicks are audible or likely.

**Split into equal parts or at times.**
`ffmpeg -i in.mp4 -c copy -map 0 -f segment -segment_time 60 -reset_timestamps 1 part_%03d.mp4`
Stream-copied segments break on keyframes, so lengths vary. For exact lengths re-encode and add `-force_key_frames "expr:gte(t,n_forced*60)"`, or use `-segment_times 30,95,140` for specific times.

## Join Parts of One Work

Same codec, resolution, fps, pixel format and audio layout (typically pieces cut from one source or one camera): concat demuxer with stream copy. Write a list file:

```
file 'part_001.mp4'
file 'part_002.mp4'
```

`ffmpeg -f concat -safe 0 -i list.txt -c copy out.mp4`

If the parts differ in any of those properties, normalize them or use the concat filter with re-encode (scale/pad each input to one size, `fps` to one rate, `aresample` to one rate, then `concat=n=2:v=1:a=1`). A part without audio needs a generated silent track (`anullsrc`) so streams line up. Independent materials that need selection and ordering belong to [video-edit-assembly](../../video-edit-assembly/SKILL.md).

## Transcode and Compress

Default delivery format when the user names none: MP4, H.264 `libx264`, `-pix_fmt yuv420p`, AAC audio, `-movflags +faststart`. It plays almost everywhere, including web browsers and messaging apps.

- **Quality target:** `-crf 18`–`23` (lower is better and larger); `-preset slow` trades time for size.
- **Size target** (for example "under 50 MB"): compute the video bitrate from the duration: `video_kbps = (target_MB * 8192 / duration_s) - audio_kbps`, leaving 3–5% margin for container overhead. Then encode in two passes:
  `ffmpeg -y -i in.mp4 -c:v libx264 -b:v 2400k -pass 1 -passlogfile pass -an -f null -`
  `ffmpeg -i in.mp4 -c:v libx264 -b:v 2400k -pass 2 -passlogfile pass -c:a aac -b:a 128k -movflags +faststart out.mp4`
  (`-f null -` works on all three systems.) If the required bitrate is too low for the resolution, reduce resolution or fps as well and say so.
- **HEVC/H.265:** `libx265`, add `-tag:v hvc1` so Apple players accept it. **VP9/WebM:** `libvpx-vp9 -crf 32 -b:v 0` with `libopus` audio. **ProRes for editing:** `prores_ks -profile:v 3`. Check `ffmpeg -encoders` first; fall back to the default H.264 profile and report it.
- **Audio only:** `-vn -c:a libmp3lame -q:a 2` (MP3), `-c:a aac -b:a 192k` (M4A), `-c:a pcm_s16le` (WAV), `-c:a flac`.
- **Container change only** (for example MKV to MP4 with compatible codecs): `-c copy`. If the codec is not allowed in the target container, re-encode that stream only.

Check: codec, container, size and duration in `video_metadata`; compare a few frames against the source for visible quality loss.

## GIF and Animated Images

Two-stage palette for good color:

```
fps=12,scale=480:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5
```

`ffmpeg -ss 3 -t 4 -i in.mp4 -filter_complex_script gif.txt -loop 0 out.gif`

- Size is driven by duration × fps × width; GIFs are large. For a size limit, lower fps (10–15), width, duration, then colors (`palettegen=max_colors=128`).
- Animated WebP (`-c:v libwebp_anim` or `libwebp`, `-loop 0 -q:v 70`) is far smaller where the destination accepts it.
- GIF has no audio. Check frame count, loop and file size; view a few frames for banding or dithering noise.

## Resolution, Aspect Ratio, Orientation

- **Scale keeping aspect:** `scale=1280:-2` (the `-2` keeps the height even, which H.264 with yuv420p requires). When upscaling, use `flags=lanczos` and, if needed, light sharpening from [retouch.md](retouch.md#denoise-and-sharpen).
- **Change aspect, choose one treatment and state it:**
  - Fit with bars (no content lost): `scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=black`
  - Fill by cropping (edges lost): `scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920`. Check with `video_observe` that the subject stays in frame across the whole clip; a fixed center crop can cut off a moving subject. Use an offset `crop=w:h:x:y` per range when needed, and report it.
  - Blurred background fill (common for landscape-to-vertical): split the input, scale-and-crop one copy to the canvas and blur it (`boxblur=20:5`), scale the other to fit, then `overlay=(W-w)/2:(H-h)/2`.
- **Rotation:** if `video_metadata` reports rotation metadata, ffmpeg normally applies it on re-encode. For content shot sideways with no metadata, use `transpose=1` (90° clockwise), `transpose=2` (counterclockwise), or `hflip,vflip` (180°). Confirm orientation from frames, not from the file name.
- **Black bars in the source:** `cropdetect` over several windows suggests a crop; verify it on frames before applying.

## Frame Rate

- Conform to a rate: `fps=30` (drops or duplicates frames; motion cadence can stutter when the ratio is not whole).
- Smooth conversion or slow motion by interpolation: `minterpolate=fps=60:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1`. It is slow, and it smears or warps fast motion, occlusions and on-screen text. Inspect consecutive frames in high-motion windows and report artifacts.
- Keep fractional rates exact (`30000/1001`) when matching broadcast or camera footage.

## Speed, Reverse, Freeze

- **Change speed by factor S** (2 = twice as fast): video `setpts=PTS/S`, audio `atempo=S` (pitch-preserving). `atempo` accepts 0.5–100 per instance; chain it for slower speeds (`atempo=0.5,atempo=0.5` for 0.25×). Mute the audio instead when sped-up speech would be meaningless and the user did not ask for it.
- **Smooth slow motion:** interpolate first (`minterpolate`, above) and then slow down, or slow down with frame repetition and accept the stutter; say which.
- **Reverse:** `reverse` and `areverse` hold the whole clip in memory; split long clips into short segments, reverse each, and join in reverse order.
- **Freeze a frame:** extract it (`-ss T -frames:v 1 still.png`) and encode it as a clip of the needed length (`-loop 1 -t 2`), then join; or use `tpad=stop_mode=clone:stop_duration=2` to hold the last frame.

Check: output duration equals the source range divided by S (within a frame), audio stays in sync, and motion looks as intended in consecutive frames.

## Loop and Extend

- Repeat whole file N extra times without re-encoding: `ffmpeg -stream_loop 2 -i in.mp4 -c copy out.mp4` (3 plays total).
- Loop to an exact length: `-stream_loop -1 -i in.mp4 -t 60` with re-encode.
- A seamless loop needs the last frame to match the first. Check the join; if it jumps, a crossfade (`xfade=transition=fade:duration=0.5`, with `acrossfade` for audio) between the tail and the head can hide it. Report when the content cannot loop cleanly.
- Music loops: loop the audio (`aloop` or `-stream_loop`), fade in and out at the ends, and check the join by listening if possible.

## Audio Tracks

- **Extract:** `-vn -c:a copy out.m4a` when the codec fits the container, otherwise re-encode (see Transcode).
- **Remove:** `-an -c:v copy`.
- **Replace:** `ffmpeg -i video.mp4 -i music.mp3 -map 0:v -map 1:a -c:v copy -c:a aac -shortest out.mp4`. Decide what happens when lengths differ: `-shortest`, loop the music, or fade it out at the video's end (`afade=t=out:st=<end-3>:d=3`).
- **Mix a second track under the original:** `[0:a]volume=1.0[a0];[1:a]volume=0.25[a1];[a0][a1]amix=inputs=2:duration=first:normalize=0[a]`. `normalize=0` keeps the stated levels; check the sum does not clip.
- **Volume change:** `volume=1.5` or `volume=-6dB`. Large gains raise noise and can clip; `alimiter` caps peaks.
- **Loudness normalization** (consistent level, platform targets such as -14 LUFS for streaming or -16 for podcasts): two-pass `loudnorm`. Pass 1 measures:
  `ffmpeg -i in.mp4 -af loudnorm=I=-14:TP=-1.5:LRA=11:print_format=json -f null -`
  Pass 2 applies the measured values: `loudnorm=I=-14:TP=-1.5:LRA=11:measured_I=...:measured_TP=...:measured_LRA=...:measured_thresh=...:offset=...:linear=true`, with `-c:v copy`. Re-measure the output and report the integrated loudness and true peak.
- **Fades:** `afade=t=in:d=1`, `afade=t=out:st=<duration-2>:d=2`; for video, `fade=t=in:d=0.5` / `fade=t=out:st=...:d=0.5`.
- **Channels:** mono from stereo `-ac 1`; one channel only `pan=mono|c0=FL`; resample `-ar 48000`.

Noise reduction for audio is in [retouch.md](retouch.md#denoise-and-sharpen).

## Mask, Blur or Pixelate a Region

For privacy (faces, plates, screens) or covering an element. Find the region on frames first; give coordinates in source pixels.

- **Static region, blur:** crop the region, blur it, overlay it back:
  `[0:v]split[base][r];[r]crop=200:80:40:600,boxblur=10:2[b];[base][b]overlay=40:600`
- **Pixelate:** replace the blur with `scale=iw/16:-1,scale=200:80:flags=neighbor`.
- **Solid box:** `drawbox=x=40:y=600:w=200:h=80:color=black@1:t=fill`.
- **Time-limited:** add `enable='between(t,5,12)'` to the overlay or drawbox.
- **Moving region** (a face that moves): split the clip into ranges where a fixed box covers the subject, or use several `enable` ranges with different boxes. Check with frames across each range that the subject never leaves the box, and report a residual exposure rather than hiding it.

Check frames at the start, middle and end of each masked range.

## Burned-in Text and Subtitles

Simple static text with `drawtext` needs a font file that covers the characters (CJK needs a CJK font; pass `fontfile=` explicitly). Speech subtitles, timing and styling belong to [video-speech-workflows](../../video-speech-workflows/SKILL.md).
