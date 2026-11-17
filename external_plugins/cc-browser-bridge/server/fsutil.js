// 受限文件系统工具（R4，针对 Windows 中文路径下 fs.rmSync 幽灵成功的实机证据）：
//   rmOwnedSync(target)：删除「本组件自身创建」的目录/文件——
//   - 不跟随符号链接（lstat 判型；链接本身 unlink，绝不递归进目标，防逃逸）
//   - 逐层 unlink + rmdir（Windows 实机验证可靠的原语组合，见 windows-fs-unicode.json）
//   - 删除后必须验证不存在；瞬时失败/延迟短暂退避后重试；最终仍存在则抛错，
//     绝不吞掉删除失败后报告成功
//   - 仅用于明确拥有的路径（锁目录 / stage / backup / 自身会话文件），不做任何全局清理
"use strict";

const fs = require("fs");
const path = require("path");

const sleepSync = (ms) => {
  try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); } catch (e) {}
};

function removeOnce(target) {
  let st;
  try { st = fs.lstatSync(target); } catch (e) {
    if (e.code === "ENOENT") return;
    throw e;
  }
  if (st.isDirectory()) {
    let names = [];
    try { names = fs.readdirSync(target); } catch (e) {
      if (e.code === "ENOENT") return;
      throw e;
    }
    for (const name of names) removeOnce(path.join(target, name));
    try { fs.rmdirSync(target); } catch (e) {
      if (e.code === "ENOENT") return;
      throw e;
    }
  } else {
    try { fs.unlinkSync(target); } catch (e) {
      if (e.code === "ENOENT") return;
      throw e;
    }
  }
}

function rmOwnedSync(target, opts = {}) {
  const attempts = Number(opts.attempts || 4);
  let lastErr = null;
  for (let i = 0; i < attempts; i++) {
    try { removeOnce(target); } catch (e) { lastErr = e; }
    let exists = true;
    try { fs.lstatSync(target); }
    catch (e) {
      // 只有 ENOENT 才能证明「确实不存在」；其余错误（EACCES/EPERM 等）一律视为仍存在，
      // 继续重试并最终抛错——绝不把验证失败当作删除成功（r4-final-finding）
      if (e.code === "ENOENT") exists = false;
      else if (!lastErr) lastErr = e;
    }
    if (!exists) return; // 验证通过：确实不存在了
    if (i < attempts - 1) sleepSync(25); // Windows/杀软延迟：短暂退避后重试
  }
  throw new Error("删除自身目录/文件后仍存在（疑似文件系统延迟或占用）：" + target + (lastErr ? "（最后错误：" + lastErr.message + "）" : ""));
}

module.exports = { rmOwnedSync };
