// vditor 的官方 d.ts 引用了 .less 资源，NodeNext 解析失败；
// 这里按本插件实际使用的 API 子集声明类型（运行时以 esbuild 打包的官方包为准）。
declare module "vditor" {
  export interface VditorOptions {
    mode?: "ir" | "wysiwyg" | "sv";
    cdn?: string;
    lang?: string;
    icon?: string;
    height?: number | string;
    placeholder?: string;
    theme?: "classic" | "dark";
    value?: string;
    cache?: { enable?: boolean };
    counter?: { enable?: boolean };
    outline?: { enable?: boolean; position?: "left" | "right" };
    toolbar?: Array<string | { name: string }>;
    preview?: {
      mode?: "both" | "editor";
      math?: { engine?: "KaTeX" | "MathJax" };
      hljs?: { style?: string; lineNumber?: boolean };
    };
    input?: (value: string) => void;
    after?: () => void;
  }
  export default class Vditor {
    constructor(id: string | HTMLElement, options?: VditorOptions);
    getValue(): string;
    setValue(markdown: string, clearStack?: boolean): void;
    getSelection(): string;
    setTheme(
      theme: "classic" | "dark",
      contentTheme?: string,
      codeTheme?: string,
      contentThemePath?: string,
    ): void;
    getCurrentMode(): "ir" | "wysiwyg" | "sv";
    focus(): void;
    blur(): void;
    destroy(): void;
  }
}
