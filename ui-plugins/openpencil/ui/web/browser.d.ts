// 上游锁定 TypeScript 5.8，其 DOM 声明尚未包含该标准方法。
// fig 编码器在调用前检查 typeof，并在旧 Chromium 上使用现有回退路径。
interface Uint8Array {
  toHex(): string;
}
