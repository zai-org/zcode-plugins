import { useClockReadout } from '@/hooks/useFreezeParams'
/** Shown only with ?hud=1. Prints the published clock snapshot (time / t / frame) in the frame's own
 *  pixels. It marks the driver values React content rendered with; CSS and WebGL timelines are separate.
 *  It observes the clock without driving it: the origin is set by the first content subscriber, so a
 *  capture with ?hud=1 shows the same times as one without (a page with no subscriber reads 0 / f=0). */
export function ForensicHud() {
  if (new URLSearchParams(window.location.search).get('hud') !== '1') return null
  return <HudReadout />
}
function HudReadout() {
  const { time, t, frame } = useClockReadout()
  return <div data-forensic-hud style={{ position: 'fixed', right: 4, bottom: 4, zIndex: 2147483647,
    font: '12px/1 monospace', color: '#0f0', background: 'rgba(0,0,0,.8)', padding: '2px 4px',
    pointerEvents: 'none', whiteSpace: 'pre' }}>{`time=${time.toFixed(3)} t=${t.toFixed(3)} f=${frame}`}</div>
}
