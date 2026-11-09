// 生成测试用的小 PDF：Helvetica（WinAnsi 编码）文本、每行一个文本对象，可选页面标签。
// 不依赖任何库，便于审阅与复现。

/** WinAnsi 字节（含弯引号 ’ “ ” 与 – —）。 */
function winAnsi(text) {
  const map = { "’": 0x92, "‘": 0x91, "“": 0x93, "”": 0x94, "–": 0x96, "—": 0x97 };
  const bytes = [];
  for (const char of text) {
    const code = map[char] ?? char.charCodeAt(0);
    if (code === 0x28 || code === 0x29 || code === 0x5c) bytes.push(0x5c);
    bytes.push(code > 255 ? 0x3f : code);
  }
  return Buffer.from(bytes);
}

/**
 * @param {string[][]} pages 每页的文本行
 * @param {{ labels?: { start: number, style: "r" | "D", first?: number }[], width?: number, height?: number }} [options]
 */
export function makePdf(pages, options = {}) {
  const width = options.width ?? 612;
  const height = options.height ?? 792;
  const objects = [];
  const add = (body) => {
    objects.push(body);
    return objects.length;
  };
  const font = add(Buffer.from("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>"));
  const pagesId = objects.length + 1;
  objects.push(null); // Pages 占位
  const kids = [];
  for (const lines of pages) {
    const parts = [Buffer.from("BT /F1 11 Tf 14 TL 72 720 Td\n")];
    for (const line of lines) parts.push(Buffer.from("("), winAnsi(line), Buffer.from(") Tj T*\n"));
    parts.push(Buffer.from("ET\n"));
    const stream = Buffer.concat(parts);
    const content = add(Buffer.concat([Buffer.from(`<< /Length ${stream.length} >>\nstream\n`), stream, Buffer.from("\nendstream")]));
    kids.push(
      add(Buffer.from(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${width} ${height}] /Contents ${content} 0 R /Resources << /Font << /F1 ${font} 0 R >> >> >>`)),
    );
  }
  objects[pagesId - 1] = Buffer.from(`<< /Type /Pages /Kids [${kids.map((id) => `${id} 0 R`).join(" ")}] /Count ${kids.length} >>`);
  const labels = options.labels
    ? ` /PageLabels << /Nums [${options.labels.map((label) => `${label.start} << /S /${label.style}${label.first ? ` /St ${label.first}` : ""} >>`).join(" ")}] >>`
    : "";
  const catalog = add(Buffer.from(`<< /Type /Catalog /Pages ${pagesId} 0 R${labels} >>`));
  const chunks = [Buffer.from("%PDF-1.4\n%\xe2\xe3\xcf\xd3\n", "latin1")];
  const offsets = [];
  let length = chunks[0].length;
  objects.forEach((body, index) => {
    offsets.push(length);
    const chunk = Buffer.concat([Buffer.from(`${index + 1} 0 obj\n`), body, Buffer.from("\nendobj\n")]);
    chunks.push(chunk);
    length += chunk.length;
  });
  const xref = [`xref\n0 ${objects.length + 1}\n`, "0000000000 65535 f \n", ...offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)].join("");
  chunks.push(Buffer.from(`${xref}trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${length}\n%%EOF\n`));
  return Buffer.concat(chunks);
}

/** 测试论文：三页，罗马数字前言页，包含行尾连字符断词与弯引号。 */
export function samplePaper() {
  return makePdf(
    [
      ["Preface", "This front matter page is labelled with a roman numeral."],
      [
        "Second-Class Values Revisited",
        "Abstract. We design a type system that tracks storage modes.",
        "When a function returns a stack-allocated value, we just don’t",
        "pop the stack! Instead, the stack frame is de-",
        "allocated together with a parent the next time.",
        "The “delayed popping” strategy reduces GC pressure.",
      ],
      ["Evaluation", "Execution time improves between 10% and 25% with respect", "to standard execution on our benchmarks."],
    ],
    { labels: [{ start: 0, style: "r" }, { start: 1, style: "D" }] },
  );
}
