// 页面脚本：处理订阅表单（这一行是注释，不会显示在页面上）
const input = document.querySelector("input");
/* TODO: 以后接入会员积分系统，暂时不做 */
input?.addEventListener("change", () => {
  const ok = /@/.test(input.value);
  alert(ok ? "订阅成功，谢谢！" : "邮箱格式好像不对，请再检查一下。");
});
// 链接: https://example.com/不要显示
