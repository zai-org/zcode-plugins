import { pdfFontkit as fontkit } from "../src/kit/pdf-fontkit.ts";
import { PDFDocument, rgb } from "pdf-lib";
import { findPdfFont } from "../src/kit/fonts.ts";

/** 一份中文培训报名表：有表单域（姓名、电话、地址、课程下拉、性别单选、是否住宿复选框）。 */
export async function makeChineseForm(withFields = true): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit as any);
  const { face, subset } = await findPdfFont();
  const font = await doc.embedFont(face, { subset });
  const page = doc.addPage([595, 842]);
  const form = doc.getForm();
  page.drawText("2026 年冬季培训班报名表", { x: 170, y: 780, size: 20, font });
  const rows: [string, string, number][] = [
    ["姓名", "name", 700],
    ["手机号", "phone", 660],
    ["身份证号", "idcard", 620],
    ["通讯地址", "address", 580],
  ];
  for (const [label, key, y] of rows) {
    page.drawText(label, { x: 60, y: y + 6, size: 12, font });
    page.drawRectangle({ x: 140, y, width: 380, height: 24, borderColor: rgb(0.4, 0.4, 0.4), borderWidth: 0.8 });
    if (withFields) {
      const field = form.createTextField(key);
      field.addToPage(page, { x: 140, y, width: key === "phone" ? 180 : 380, height: 24, font });
    }
  }
  page.drawText("报名课程", { x: 60, y: 546, size: 12, font });
  page.drawText("性别", { x: 60, y: 506, size: 12, font });
  page.drawText("需要住宿", { x: 60, y: 466, size: 12, font });
  page.drawText("备注", { x: 60, y: 426, size: 12, font });
  page.drawRectangle({ x: 140, y: 340, width: 380, height: 100, borderColor: rgb(0.4, 0.4, 0.4), borderWidth: 0.8 });
  if (withFields) {
    const course = form.createDropdown("course");
    course.addOptions(["Python 入门", "数据分析", "AI 应用开发"]);
    course.addToPage(page, { x: 140, y: 540, width: 200, height: 22, font });
    const gender = form.createRadioGroup("gender");
    gender.addOptionToPage("男", page, { x: 140, y: 500, width: 14, height: 14 });
    gender.addOptionToPage("女", page, { x: 200, y: 500, width: 14, height: 14 });
    const stay = form.createCheckBox("stay");
    stay.addToPage(page, { x: 140, y: 460, width: 14, height: 14 });
    const note = form.createTextField("note");
    note.enableMultiline();
    note.addToPage(page, { x: 140, y: 340, width: 380, height: 100, font });
  }
  page.drawText("男", { x: 158, y: 502, size: 11, font });
  page.drawText("女", { x: 218, y: 502, size: 11, font });
  if (withFields) form.updateFieldAppearances(font);
  return doc.save();
}

const surnames = "王李张刘陈杨黄赵吴周徐孙马朱胡郭何高林罗";
const given = ["伟", "芳", "娜", "秀英", "敏", "静", "丽", "强", "磊", "军", "洋", "勇", "艳", "杰", "娟", "涛", "明", "超", "秀兰", "霞"];
const courses = ["Python 入门", "数据分析", "AI 应用开发"];

/** 30 行名单：第 7 行缺手机号，第 12 行地址超长，第 20 行课程不在下拉选项里。 */
export function makeRoster(): string {
  const lines = ["姓名,手机号,身份证号,通讯地址,课程,性别,住宿,备注"];
  for (let i = 0; i < 30; i++) {
    const name = surnames[i % surnames.length] + given[(i * 7) % given.length];
    const phone = i === 6 ? "" : `1${38 + (i % 10)}${String(10000000 + i * 7919).slice(0, 8)}`;
    const id = `11010519${80 + (i % 20)}0${(i % 9) + 1}1${String(100 + i).slice(-3)}${i % 10}`;
    const address =
      i === 11
        ? "广东省深圳市南山区粤海街道科技园南区高新南七道深圳软件产业基地第四栋B座十二层1203室 前台代收（工作日 9:00-18:00）"
        : `北京市海淀区中关村大街${i + 1}号`;
    const course = i === 19 ? "区块链" : courses[i % 3];
    const note = i % 5 === 0 ? `"已缴费，发票抬头：北京某某科技有限公司，需要在开课前一周寄送纸质教材到通讯地址。"` : "";
    lines.push([name, phone, id, `"${address}"`, course, i % 2 ? "女" : "男", i % 3 === 0 ? "是" : "否", note].join(","));
  }
  return lines.join("\n") + "\n";
}
