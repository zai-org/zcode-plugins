// 工具注册表：MCP schema + 调用计划（纯函数，无 IO）
// planFor(name, args) 返回三种指令之一：
//   { ext: tool, args }   → 转发给 Chrome 扩展执行
//   { sleep: ms }         → 桥接服务自己等待
//   { local: "..." }      → 桥接服务直接回答（无扩展依赖）

const obj = (properties, required) => ({
  type: "object",
  properties,
  additionalProperties: false,
  ...(required && required.length ? { required } : {}),
});
const S = {
  ref: { type: "integer", description: "browser_snapshot 输出中的元素编号" },
  xy: {
    type: "number",
    description: "截图坐标系下的横/纵像素（来自最近一次 browser_screenshot）",
  },
};

const TOOLS = [
  {
    name: "browser_screenshot",
    description:
      "截取当前标签页的截图（PNG）并返回给 Claude。推荐先用它看清页面再操作；" +
      "坐标类操作（browser_click 的 x/y、browser_scroll 的 x/y）基于这张截图的像素。full_page=true 可截整页。",
    inputSchema: obj({
      full_page: { type: "boolean", description: "是否截取整个页面（默认 false 只截可见区域）" },
    }),
  },
  {
    name: "browser_snapshot",
    description:
      "获取当前页面的可交互元素结构快照：链接/按钮/输入框/下拉/标题等，每项带 ref 编号、名称和位置。" +
      "后续用 browser_click/browser_type 的 ref 参数精确定位元素，比坐标更快更稳。" +
      "ref 绑定元素本身：同一文档内旧 ref 跨多次快照仍指向原元素（新元素拿新编号），元素被移除、页面导航或换文档后失效，需重新快照（ref 编号跨文档不复用）。",
    inputSchema: obj({}),
  },
  {
    name: "browser_read_page",
    description: "提取当前页面的纯文本内容（最多 2 万字符），适合读取文章/文档正文，比截图省 token。",
    inputSchema: obj({}),
  },
  {
    name: "browser_click",
    description:
      "点击元素。优先用 ref（来自 browser_snapshot）；否则用 x/y 截图坐标（需要先 browser_screenshot）。" +
      "button 可选 left/right/middle，click_count=2 为双击。",
    inputSchema: obj(
      {
        ref: S.ref,
        x: S.xy,
        y: { ...S.xy, description: "纵坐标像素" },
        button: { type: "string", enum: ["left", "right", "middle"], description: "默认 left" },
        click_count: { type: "integer", description: "默认 1；2=双击，3=三击" },
      },
      []
    ),
  },
  {
    name: "browser_type",
    description:
      "在输入框输入文本。ref 来自 browser_snapshot；不给 ref 则作用于当前焦点元素（同样支持 clear/press_enter）。" +
      "默认先清空原内容（全选后删除，按平台自动选择 Meta/Control 组合键）；press_enter=true 输入后按回车（在表单中会提交）。",
    inputSchema: obj(
      {
        ref: S.ref,
        text: { type: "string", description: "要输入的文本" },
        clear: { type: "boolean", description: "是否先清空（默认 true）" },
        press_enter: { type: "boolean", description: "输入后按回车（默认 false）" },
      },
      ["text"]
    ),
  },
  {
    name: "browser_press_key",
    description: "按键或组合键，例如 \"Enter\"、\"Escape\"、\"Tab\"、\"Control+a\"、\"Meta+c\"、\"ArrowDown\"。",
    inputSchema: obj({ key: { type: "string" } }, ["key"]),
  },
  {
    name: "browser_hover",
    description: "悬停到元素上（触发悬浮菜单等）。优先 ref，否则 x/y 截图坐标。",
    inputSchema: obj({ ref: S.ref, x: S.xy, y: { ...S.xy, description: "纵坐标像素" } }),
  },
  {
    name: "browser_select_option",
    description: "选择 <select> 下拉框的选项。value 填选项的 value 或可见文本（见 snapshot 中的 options 列表）。",
    inputSchema: obj({ ref: S.ref, value: { type: "string" } }, ["ref", "value"]),
  },
  {
    name: "browser_scroll",
    description:
      "滚动页面：direction=down/up 滚动 amount 像素（默认 600）；给 ref 则滚动到该元素；" +
      "给 x/y 则在该坐标处滚轮（适合页面内嵌滚动区）。",
    inputSchema: obj({
      direction: { type: "string", enum: ["up", "down"], description: "默认 down" },
      amount: { type: "integer", description: "像素，默认 600" },
      ref: S.ref,
      x: S.xy,
      y: { ...S.xy, description: "纵坐标像素" },
    }),
  },
  {
    name: "browser_navigate",
    description: "当前标签页打开网址（无协议时自动加 https://）。可用 tab_id 指定其他标签页。",
    inputSchema: obj({ url: { type: "string" }, tab_id: { type: "integer" } }, ["url"]),
  },
  {
    name: "browser_history",
    description: "浏览器历史操作：back 后退 / forward 前进 / reload 刷新。",
    inputSchema: obj(
      { action: { type: "string", enum: ["back", "forward", "reload"] } },
      ["action"]
    ),
  },
  {
    name: "browser_tabs",
    description:
      "标签页管理：list 列出全部标签（含 tab_id）；new 新建（可带 url）；activate 切换到 tab_id；close 关闭 tab_id。",
    inputSchema: obj(
      {
        action: { type: "string", enum: ["list", "new", "activate", "close"] },
        tab_id: { type: "integer", description: "activate/close 必填" },
        url: { type: "string", description: "new 时可选" },
      },
      ["action"]
    ),
  },
  {
    name: "browser_wait",
    description: "等待 ms 毫秒（≤10000），用于等页面加载或动画完成。",
    inputSchema: obj({ ms: { type: "integer", maximum: 10000 } }, ["ms"]),
  },
  {
    name: "browser_evaluate",
    description:
      "在当前页面执行 JavaScript（会被包成 async 函数体，可用 await，用 return 返回结果），" +
      "用于精确提取页面数据。返回值需可 JSON 序列化。",
    inputSchema: obj({ code: { type: "string" } }, ["code"]),
  },
  {
    name: "computer",
    description:
      "Anthropic computer-use 标准工具格式（beta computer_20250124）的浏览器实现，" +
      "供官方 computer-use 循环代码直接调用：action=screenshot/left_click/right_click/double_click/" +
      "triple_click/middle_click/mouse_move/cursor_position/left_click_drag/key/type/scroll/" +
      "left_mouse_down/left_mouse_up/wait，坐标 coordinate=[x,y] 基于最近一次截图。" +
      "一般情况建议优先使用上面的 browser_* 工具（更省 token、更稳）。",
    inputSchema: obj(
      {
        action: { type: "string" },
        coordinate: { type: "array", items: { type: "number" }, description: "[x, y] 截图像素坐标" },
        start_coordinate: { type: "array", items: { type: "number" }, description: "拖拽起点" },
        text: { type: "string" },
        key: { type: "string" },
        direction: { type: "string", enum: ["up", "down"] },
        amount: { type: "number", description: "滚动量（格），默认 1" },
        duration: { type: "number", description: "wait 的秒数" },
        scroll_direction: { type: "string", enum: ["up", "down"] },
        scroll_amount: { type: "number" },
        hold_key: { type: "string" },
        hold_type: { type: "string" },
      },
      ["action"]
    ),
  },
];

// ---------- 调用计划 ----------
const needNum = (v, name) => {
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error("参数 " + name + " 必须是数字");
  return n;
};

function planFor(name, args) {
  const a = args || {};
  switch (name) {
    case "browser_screenshot":
      return { ext: a.full_page ? "screenshot_full" : "screenshot" };

    case "browser_snapshot":
      return { ext: "snapshot" };

    case "browser_read_page":
      return { ext: "read_page" };

    case "browser_click": {
      if (a.ref != null) return { ext: "click_ref", args: { ref: a.ref } };
      if (a.x == null || a.y == null)
        throw new Error("browser_click 需要 ref（推荐，来自 browser_snapshot）或 x+y 截图坐标");
      return {
        ext: "click_xy",
        args: {
          x: needNum(a.x, "x"), y: needNum(a.y, "y"),
          button: a.button || "left", click_count: a.click_count || 1,
        },
      };
    }

    case "browser_type":
      if (a.text == null) throw new Error("缺少 text");
      return { ext: "type", args: { ref: a.ref, text: String(a.text), clear: a.clear !== false, press_enter: !!a.press_enter } };

    case "browser_press_key":
      if (!a.key) throw new Error("缺少 key");
      return { ext: "press_key", args: { key: String(a.key) } };

    case "browser_hover":
      if (a.ref != null) return { ext: "hover_ref", args: { ref: a.ref } };
      if (a.x == null || a.y == null) throw new Error("browser_hover 需要 ref 或 x+y");
      return { ext: "move_to", args: { x: needNum(a.x, "x"), y: needNum(a.y, "y") } };

    case "browser_select_option":
      return { ext: "select_option", args: { ref: a.ref, value: String(a.value) } };

    case "browser_scroll": {
      const args = {
        direction: a.direction || "down",
        amount: a.amount != null ? needNum(a.amount, "amount") : 600,
        ref: a.ref,
      };
      if (a.x != null && a.y != null) { args.x = needNum(a.x, "x"); args.y = needNum(a.y, "y"); }
      return { ext: "scroll", args };
    }

    case "browser_navigate":
      if (!a.url) throw new Error("缺少 url");
      return { ext: "navigate", args: { url: String(a.url), tab_id: a.tab_id } };

    case "browser_history":
      return { ext: "history", args: { action: a.action || "back" } };

    case "browser_tabs":
      return { ext: "tabs", args: { action: a.action || "list", tab_id: a.tab_id, url: a.url } };

    case "browser_wait": {
      const ms = Math.max(0, Math.min(10000, Number(a.ms) || 0));
      return { sleep: ms };
    }

    case "browser_evaluate":
      if (!a.code) throw new Error("缺少 code");
      return { ext: "evaluate", args: { code: String(a.code) } };

    case "computer":
      return planComputer(a);

    default:
      throw new Error("未知工具: " + name);
  }
}

function planComputer(a) {
  const action = String(a.action || "");
  const c = a.coordinate || [];
  const px = (i) => needNum(c[i], "coordinate[" + i + "]");
  switch (action) {
    case "screenshot":
      return { ext: "screenshot" };
    case "left_click":
    case "click":
      return { ext: "click_xy", args: { x: px(0), y: px(1), button: "left", click_count: 1 } };
    case "left_double_click":
    case "double_click":
      return { ext: "click_xy", args: { x: px(0), y: px(1), button: "left", click_count: 2 } };
    case "triple_click":
      return { ext: "click_xy", args: { x: px(0), y: px(1), button: "left", click_count: 3 } };
    case "right_click":
      return { ext: "click_xy", args: { x: px(0), y: px(1), button: "right", click_count: 1 } };
    case "middle_click":
      return { ext: "click_xy", args: { x: px(0), y: px(1), button: "middle", click_count: 1 } };
    case "mouse_move":
      return { ext: "move_to", args: { x: px(0), y: px(1) } };
    case "cursor_position":
      return { ext: "cursor_position" };
    case "left_click_drag":
    case "left_drag":
      return {
        ext: "drag_to",
        args: {
          from_x: needNum((a.start_coordinate || [])[0], "start_coordinate[0]"),
          from_y: needNum((a.start_coordinate || [])[1], "start_coordinate[1]"),
          to_x: px(0), to_y: px(1),
        },
      };
    case "key":
    case "hold_key":
      if (!a.key) throw new Error("computer key 需要 key 参数");
      return { ext: "press_key", args: { key: String(a.key) } };
    case "type":
      if (a.text == null) throw new Error("computer type 需要 text 参数");
      return { ext: "type", args: { text: String(a.text), clear: false } };
    case "scroll": {
      const dir = a.scroll_direction || a.direction || "down";
      const amt = (a.scroll_amount != null ? Number(a.scroll_amount) : (a.amount != null ? Number(a.amount) : 1)) * 400;
      return {
        ext: "scroll",
        args: {
          x: c.length ? px(0) : undefined, y: c.length ? px(1) : undefined,
          direction: dir === "up" ? "up" : "down", amount: Math.round(amt),
        },
      };
    }
    case "left_mouse_down":
      return { ext: "mouse_down", args: c.length ? { x: px(0), y: px(1) } : {} };
    case "left_mouse_up":
      return { ext: "mouse_up", args: c.length ? { x: px(0), y: px(1) } : {} };
    case "wait":
      return { sleep: Math.max(0, Math.min(10000, Math.round((Number(a.duration) || 1) * 1000))) };
    default:
      throw new Error("computer 不支持的 action: " + action);
  }
}

// ---------- 结果整形（扩展返回值 → MCP content blocks） ----------
const shotMeta = (r) => {
  const meta = { width: r.width, height: r.height, scale: r.scale, title: r.title, url: r.url };
  const text =
    "截图 " + r.width + "x" + r.height + "（截图像素:CSS像素=" + (Math.round(r.scale * 100) / 100) +
    "，坐标工具按截图像素计）\n标题: " + r.title + "\nURL: " + r.url;
  return {
    meta,
    content: [
      { type: "image", data: r.data, mimeType: "image/png" },
      { type: "text", text },
    ],
  };
};

function shapeResult(toolName, r) {
  if (r == null) return { content: [{ type: "text", text: "完成" }] };
  if (toolName === "screenshot" || toolName === "screenshot_full") return shotMeta(r);
  if (r.error) return { isError: true, content: [{ type: "text", text: String(r.error) }] };
  let text;
  if (toolName === "snapshot")
    text =
      "# 页面快照\n标题: " + r.title + "\nURL: " + r.url + "\n元素数: " + r.count +
      "\n\n" + r.snapshot;
  else if (toolName === "read_page")
    text = "标题: " + r.title + "\nURL: " + r.url + "\n\n" + r.text;
  else text = JSON.stringify(r, null, 0);
  return { content: [{ type: "text", text }] };
}

module.exports = { TOOLS, planFor, shapeResult };
