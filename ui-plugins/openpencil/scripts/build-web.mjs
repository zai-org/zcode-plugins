import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { readFile, writeFile } from "node:fs/promises";
import { transform } from "esbuild";
import { prepareUpstream, pluginRoot, upstreamRevision } from "./upstream.mjs";

export async function buildWebEditor() {
  const root = await prepareUpstream();
  const require = createRequire(join(root, "package.json"));
  const load = (name) => import(pathToFileURL(require.resolve(name)).href);
  const aliasesSource = await transform(await readFile(join(root, "vite/aliases.ts"), "utf8"), {
    loader: "ts",
    format: "esm",
  });
  const [
    { build },
    { default: vue },
    { default: tailwind },
    { default: Icons },
    { default: Components },
    { default: IconsResolver },
    { createOpenPencilAliases },
  ] = await Promise.all([
    load("vite"),
    load("@vitejs/plugin-vue"),
    load("@tailwindcss/vite"),
    load("unplugin-icons/vite"),
    load("unplugin-vue-components/vite"),
    load("unplugin-icons/resolver"),
    import(`data:text/javascript;base64,${Buffer.from(aliasesSource.code).toString("base64")}`),
  ]);
  const web = join(pluginRoot, "ui/web");
  const overrides = {
    "@/router": "router.ts",
    "@/app/document/io": "document-io.ts",
    "@/app/shell/menu/files": "files.ts",
    "@/app/shell/menu/navigation": "navigation.ts",
    "@/app/tabs": "tabs.ts",
    "@/components/CollabPanel/CollabPanel.vue": "HostBar.vue",
    "@/components/MobileHud/MobileShareButton.vue": "MobileContextButton.vue",
  };
  const inputs = {};
  const result = await build({
    configFile: false,
    root,
    publicDir: false,
    resolve: {
      dedupe: ["vue"],
      alias: [
        ...Object.entries(overrides).map(([find, file]) => ({
          find: new RegExp(`^${find.replaceAll("/", "\\/")}$`),
          replacement: join(web, file),
        })),
        { find: /^\.\/ChatPanel\.vue$/, replacement: join(web, "ZCodePanel.vue") },
        { find: "#upstream-tabs", replacement: join(root, "src/app/tabs/index.ts") },
        { find: "#ui", replacement: join(pluginRoot, "ui") },
        { find: "#openpencil", replacement: join(pluginRoot, "src") },
        { find: /^vue$/, replacement: require.resolve("vue/dist/vue.runtime.esm-bundler.js") },
        { find: "@unhead/vue/client", replacement: require.resolve("@unhead/vue/client") },
        { find: /^reka-ui$/, replacement: require.resolve("reka-ui").replace(/\.cjs$/, ".js") },
        {
          find: /^vue-router$/,
          replacement: join(root, "node_modules/vue-router/dist/vue-router.js"),
        },
        { find: "/favicon-32.png", replacement: join(root, "public/pwa-192.png") },
        ...createOpenPencilAliases(root),
      ],
    },
    define: {
      __OPENPENCIL_APP_VERSION__: JSON.stringify("0.14.0"),
      __OPENPENCIL_LOCAL_AUTOMATION_TOKEN__: "null",
    },
    plugins: [
      {
        name: "zcode-ui-provenance",
        enforce: "pre",
        transform(code, id) {
          inputs[id.split("?")[0]] = {};
          if (id.endsWith(".md")) return `export default ${JSON.stringify(code)};`;
          if (id === join(root, "src/app/editor/active-store/index.ts")) {
            // 上游代理缺少 has，画布的能力检测失败后退回整个窗口宽度，导致居中偏移。
            const anchor = "const storeProxy = new Proxy({} as EditorStore, {";
            if (!code.includes(anchor)) throw new Error("OpenPencil active store changed");
            return code.replace(
              anchor,
              `${anchor}\n  has(_, prop) { return Reflect.has(getActiveEditorStore(), prop) },`,
            );
          }
          if (id === join(root, "src/components/canvas/CanvasMenu.vue")) {
            // 保留上游菜单全部行为，只在明确的扩展点插入宿主选区操作。
            const anchor = '<ContextMenuContent :class="cls.menu" :side-offset="2" align="start">';
            if (!code.includes(anchor))
              throw new Error("OpenPencil canvas menu integration point changed");
            return code
              .replace(
                '<script setup lang="ts">',
                '<script setup lang="ts">\nimport ZCodeContextActions from "#ui/web/ContextActions.vue";',
              )
              .replace(anchor, `${anchor}\n<ZCodeContextActions :item-class="cls.item" />`);
          }
          if (id === join(root, "src/app.css"))
            return `${code}\n@source "./";\n@source "../packages/vue/src";`;
        },
      },
      tailwind(),
      Icons({ compiler: "vue3", collectionsNodeResolvePath: root }),
      Components({
        dts: false,
        dirs: [],
        exclude: [],
        resolvers: [IconsResolver({ prefix: "icon" })],
      }),
      vue(),
    ],
    build: {
      write: false,
      target: "es2022",
      cssCodeSplit: false,
      assetsInlineLimit: 16 * 1024 * 1024,
      rollupOptions: {
        input: join(web, "main.ts"),
        output: { inlineDynamicImports: true, entryFileNames: "editor.js" },
      },
    },
    worker: { format: "es", rollupOptions: { output: { inlineDynamicImports: true } } },
  });
  const output = (Array.isArray(result) ? result[0] : result).output;
  await writeFile(join(root, ".zcode-bundle-inputs.json"), JSON.stringify(inputs));
  const js = output.find((item) => item.type === "chunk" && item.isEntry)?.code;
  if (!js) throw new Error("Upstream editor entry missing");
  return {
    js,
    css: output
      .filter((item) => item.type === "asset" && item.fileName.endsWith(".css"))
      .map((item) => item.source)
      .join("\n"),
    metafile: { inputs },
    provenance: { version: "0.14.0", commit: upstreamRevision },
  };
}
