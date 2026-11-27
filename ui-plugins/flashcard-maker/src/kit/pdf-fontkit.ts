import * as fontkitModule from "fontkit";

/**
 * pdf-lib 自带示例用的 @pdf-lib/fontkit（fontkit 1.x 分支）在子集化部分中文字体时会丢字。
 * 这里改用 fontkit 2.x，并把它的 subset.encode() 适配成 pdf-lib 需要的 encodeStream() 接口。
 */
const fontkit: any = fontkitModule;

function wrapSubset(subset: any) {
  return new Proxy(subset, {
    get(target, key) {
      if (key === "encodeStream")
        return () => {
          const handlers: Record<string, (value?: unknown) => void> = {};
          const stream = {
            on(event: string, handler: (value?: unknown) => void) {
              handlers[event] = handler;
              return stream;
            },
          };
          queueMicrotask(() => {
            try {
              handlers.data?.(target.encode());
              handlers.end?.();
            } catch (error) {
              handlers.error?.(error);
            }
          });
          return stream;
        };
      const value = target[key];
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

export const pdfFontkit = {
  create(buffer: Uint8Array, postscriptName?: string) {
    const font = fontkit.create(buffer, postscriptName);
    return new Proxy(font, {
      get(target, key) {
        if (key === "createSubset") return () => wrapSubset(target.createSubset());
        const value = target[key];
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  },
};
