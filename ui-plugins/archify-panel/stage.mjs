import { cp } from "node:fs/promises";
import { join } from "node:path";

// 把打包的 Archify 运行时复制进安装目录
const installDir = process.env.ZCODE_PLUGIN_INSTALL_DIR;
if (!installDir) throw new Error("ZCODE_PLUGIN_INSTALL_DIR is not set");

await cp(join(import.meta.dirname, "vendor"), join(installDir, "vendor"), {
  recursive: true,
  dereference: true,
});
