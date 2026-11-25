// engine/kit — scene→React HUD 桥 (可选)。场景里算出的值 (探针命中/读数/当前章节/滚动百分比)
// 要显示到 2D HUD 时用这个极简 pub/sub: scene 侧 store.set(), React 侧 useEffect(subscribe)。
// **状态字段由你的场景定义** (泛型 T) — kit 只给机构, 不预设任何字段。

export interface HudStore<T> {
  get(): T
  set(partial: Partial<T>): void
  // 返回 () => void, 可直接作 useEffect cleanup (不要把 Set.delete 的 boolean 泄给 React)。
  subscribe(listener: (s: T) => void): () => void
}

export function createHudStore<T extends object>(initial: T): HudStore<T> {
  const state: T = { ...initial }
  const listeners = new Set<(s: T) => void>()
  return {
    get: () => state,
    set(partial) {
      Object.assign(state, partial)
      listeners.forEach((l) => l(state))
    },
    subscribe(l) {
      listeners.add(l)
      return () => {
        listeners.delete(l)
      }
    },
  }
}
