// Forensic URL params: let a screenshot script pin the page in a deterministic state.
//   ?time=<sec>   pin the time axis at this many seconds (autoplay / looping / shader effects)
//   ?t=<0..1>     pin scroll progress (scroll-driven effects)
//   ?hud=1        print the page clock (time / t / frame) bottom-right (see components/ForensicHud.tsx)
// Both freeze params are read once at load. Without a param the axis runs live: `time` is elapsed
// seconds since the first subscription, `t` is the live scroll progress of the document.
// Every animated value must be a pure function of `time` / `t` (no `+= dt`, no Date.now(),
// no Math.random()) or the freeze cannot reproduce the frame.
import { useSyncExternalStore } from 'react'

export interface FreezeParams {
  /** elapsed seconds (frozen when ?time= is present) */
  time: number
  /** scroll progress 0..1 (frozen when ?t= is present) */
  t: number
  frozenTime: number | null
  frozenT: number | null
}

export function parseFreezeParams(search: string = window.location.search): Pick<FreezeParams, 'frozenTime' | 'frozenT'> {
  const p = new URLSearchParams(search)
  let frozenTime: number | null = null
  let frozenT: number | null = null
  const timeRaw = p.get('time')
  if (timeRaw !== null && timeRaw !== '') {
    const v = Number(timeRaw)
    if (Number.isFinite(v)) frozenTime = Math.max(0, v)
  }
  const tRaw = p.get('t')
  if (tRaw !== null && tRaw !== '') {
    const v = Number(tRaw)
    if (Number.isFinite(v)) frozenT = Math.min(1, Math.max(0, v))
  }
  return { frozenTime, frozenT }
}

function liveScrollProgress(): number {
  const max = document.documentElement.scrollHeight - window.innerHeight
  return max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0
}

/** Frozen params are constant for the page lifetime; parse once. */
const FROZEN = typeof window !== 'undefined' ? parseFreezeParams() : { frozenTime: null, frozenT: null }

/** One clock per page load. Subscribers render exactly the values published here; a capture
 *  script may read the same object as window.__v2c. Time counts from the first content subscription
 *  (`useFreezeParams`); unmount / remount does not reset it, a new navigation does. Read-only observers
 *  (`useClockReadout`, the ?hud=1 corner clock) never start or keep the clock running, so a capture
 *  with ?hud=1 has the same time origin as one without. */
export interface Clock extends FreezeParams { frame: number }
let origin: number | null = null
let clock: Clock = { time: FROZEN.frozenTime ?? 0, t: FROZEN.frozenT ?? 0, frame: 0,
                     frozenTime: FROZEN.frozenTime, frozenT: FROZEN.frozenT }
;(window as any).__v2c = clock                 // exists from module load; frame 0 when both axes are frozen
const subscribers = new Set<() => void>()      // content driven by the clock
const observers = new Set<() => void>()        // read-only (HUD); do not count toward starting the clock
let raf = 0
function publish(next: Clock) {
  clock = next; (window as any).__v2c = next
  subscribers.forEach((fn) => fn()); observers.forEach((fn) => fn())
}
function applyFrozenScroll() {
  if (FROZEN.frozenT === null) return
  const max = document.documentElement.scrollHeight - window.innerHeight
  window.scrollTo(0, FROZEN.frozenT * Math.max(0, max))
}
function tick() {
  publish({ ...clock, time: FROZEN.frozenTime ?? (performance.now() - (origin as number)) / 1000,
            t: FROZEN.frozenT ?? liveScrollProgress(), frame: clock.frame + 1 })
  raf = requestAnimationFrame(tick)
}
function subscribe(fn: () => void) {
  subscribers.add(fn)
  if (subscribers.size === 1 && raf === 0) {
    if (origin === null) {
      origin = performance.now()
      applyFrozenScroll()
      window.addEventListener('load', applyFrozenScroll, { once: true })   // layout may grow after fonts / images
    }
    if (FROZEN.frozenTime === null || FROZEN.frozenT === null) raf = requestAnimationFrame(tick)
  }
  return () => { subscribers.delete(fn); if (subscribers.size === 0) { cancelAnimationFrame(raf); raf = 0 } }
}
function observe(fn: () => void) {
  observers.add(fn)
  return () => { observers.delete(fn) }
}
if (import.meta.hot) import.meta.hot.dispose(() => cancelAnimationFrame(raf))
export function useFreezeParams(): Clock { return useSyncExternalStore(subscribe, () => clock, () => clock) }
/** The published clock without driving it: shows time 0 / frame 0 until content subscribes. */
export function useClockReadout(): Clock { return useSyncExternalStore(observe, () => clock, () => clock) }

/**
 * Inline style that pins a CSS animation to the frozen time (negative delay + paused).
 * Returns {} when the time axis is live, so the animation runs normally.
 *   <div style={{ animation: 'spin 4s linear infinite', ...cssFreezeStyle() }} />
 */
export function cssFreezeStyle(offsetSec = 0): React.CSSProperties {
  if (FROZEN.frozenTime === null) return {}
  return { animationDelay: `${-(FROZEN.frozenTime + offsetSec)}s`, animationPlayState: 'paused' }
}
