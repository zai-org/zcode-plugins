// 生成一个确定性的样例 git 仓库：node test/make-repo.mjs <目标文件夹>
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dir = join(process.argv[2] ?? ".", "shop-app");
mkdirSync(dir, { recursive: true });
let t = Date.parse("2026-09-01T10:00:00+08:00") / 1000;
const env = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" };
const git = (...a) => execFileSync("git", a, { cwd: dir, env: { ...env, GIT_AUTHOR_DATE: `${t} +0800`, GIT_COMMITTER_DATE: `${t} +0800` }, stdio: ["ignore", "pipe", "pipe"] }).toString();
git("init", "-q", "-b", "main");
git("config", "user.name", "林小满");
git("config", "user.email", "lin@example.com");
git("remote", "add", "origin", "git@github.com:qinghe-demo/shop-app.git");
let n = 0;
const commit = (msg, who) => {
  t += 3600 * 7;
  writeFileSync(join(dir, `f${n++}.txt`), msg);
  git("add", ".");
  const a = who ? ["-c", `user.name=${who}`, "-c", `user.email=${who}@example.com`] : [];
  execFileSync("git", [...a, "commit", "-q", "-m", msg], { cwd: dir, env: { ...env, GIT_AUTHOR_DATE: `${t} +0800`, GIT_COMMITTER_DATE: `${t} +0800` } });
};
commit("chore: init project");
commit("feat: member login with phone number");
commit("fix(cart): total wrong when coupon applied (#12)", "zhouning");
git("tag", "v1.0.0");
commit("feat(points): 积分兑换优惠券");
commit("修复：订单列表分页错误");
commit("docs: update README");
commit("perf: faster product search");
commit("feat(api)!: rename /orders to /v2/orders\n\nBREAKING CHANGE: old /orders endpoint removed");
git("tag", "-a", "v1.1.0", "-m", "v1.1.0");
commit("feat: dark mode (#31)", "chenxiao");
commit("fix: crash on empty cart");
commit("ci: cache pnpm store");
commit("Merge branch 'dev'");
commit("Add birthday coupons");
