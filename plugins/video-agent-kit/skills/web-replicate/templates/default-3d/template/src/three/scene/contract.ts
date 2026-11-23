// scene/contract.ts — 场景契约类型的直觉入口。类型本体在 ./Scene.ts (Stage 从那里取),
// 这里只 re-export, 让 `import type { SceneModule, SceneContext } from './contract'` 成立。
export type { SceneContext, SceneModule } from './Scene'
