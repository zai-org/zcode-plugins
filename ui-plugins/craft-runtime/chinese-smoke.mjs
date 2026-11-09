// Real Web-engine checks: Chinese content is created, rendered and persisted.
import assert from 'node:assert/strict';
import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export async function chineseSmoke({ client, name, workspace, output }) {
  await mkdir(output, { recursive: true });
  const text = '中文字体测试';
  const calls = [];
  async function call(tool, args = {}) {
    const result = await client.callTool({ name: tool, arguments: args }, undefined, { timeout: 150000 });
    assert.ok(!result.isError, `${name}.${tool}: ${JSON.stringify(result).slice(0, 1800)}`);
    calls.push(tool);
    return result;
  }
  const string = r => r.content.filter(c => c.type === 'text').map(c => c.text).join('\n');
  const json = r => JSON.parse(r.content.find(c => c.type === 'text').text);
  async function image(result, filename = `${name}-render.png`) {
    const content = result.content.find(c => c.type === 'image');
    assert.ok(content, `${name}: expected rendered image`);
    await writeFile(join(output, filename), Buffer.from(content.data, 'base64'));
    return content.data;
  }
  if (name === 'photocraft') {
    assert.match(string(await call('command_run', { id: 'prefs.get', params: { path: 'interface.language' } })), /zh-hans/);
    assert.match(string(await call('command_run', { id: 'type.fonts' })), /LXGW WenKai/);
    await call('doc_new', { width: 600, height: 220, name: text, background: 'white' });
    // Inter does not contain Chinese: this exercises the document fallback.
    await call('command_run', { id: 'type.create', params: { x: 25, y: 70, text, font: 'Inter', size: 40, color: '#000000' } });
    await call('command_run', { id: 'type.create', params: { x: 25, y: 150, text, font: 'LXGW WenKai', size: 40, color: '#000000' } });
    await call('doc_save', { path: 'chinese.psd' });
    await copyFile(join(workspace, 'chinese.psd'), join(output, 'photocraft-chinese.psd'));
    await call('doc_close');
    await call('doc_open', { path: 'chinese.psd' });
    assert.ok(string(await call('command_run', { id: 'type.info' })).includes(text));
    await call('command_run', { id: 'type.edit', params: { text: '保存后继续编辑中文' } });
    await call('doc_export', { path: 'chinese.png' });
    await copyFile(join(workspace, 'chinese.png'), join(output, 'photocraft-render.png'));
    // Upstream preference switching must remain available after the default changes.
    for (const value of ['en', 'zh-hans']) {
      await call('command_run', { id: 'prefs.set', params: { path: 'interface.language', value } });
      assert.ok(string(await call('command_run', { id: 'prefs.get', params: { path: 'interface.language' } })).includes(value));
    }
    for (const theme of ['studioLight', 'pro']) await call('ui_set', { fields: { theme } });
  } else if (name === 'vectorcraft') {
    assert.match(string(await call('run_command', { command: 'prefs.get' })), /zh-hans/);
    await call('run_command', { command: 'file.new', params: { width: 600, height: 220 } });
    await call('add_text', { text, x: 25, y: 80, size: 40 });
    await image(await call('screenshot', { scale: 1 }));
  } else if (name === 'wordcraft') {
    assert.match(string(await call('ui_inspect')), /zh-hans/);
    await call('new_document');
    await call('type_text', { text });
    await call('save_document', { path: 'chinese.docx' });
    await call('new_document');
    await call('open_document', { path: 'chinese.docx' });
    assert.ok(string(await call('get_text')).includes(text));
    await image(await call('render_page', { page: 1 }));
  } else if (name === 'gridcraft') {
    await call('new_workbook');
    await call('set_cell', { cell: 'A1', input: text });
    await call('save_workbook', { path: 'chinese.xlsx' });
    await call('new_workbook');
    await call('open_workbook', { path: 'chinese.xlsx' });
    assert.ok(string(await call('read_range', { range: 'A1' })).includes(text));
  } else if (name === 'designcraft') {
    await call('new_document', { pages: 1, title: text });
    const created = json(await call('execute', { command: 'frame.create', params: { rect: [36, 36, 450, 100], content: 'text', text } }));
    // DesignCraft deliberately disables glyph fallback per document. Preserve
    // that typography policy and verify both supported ways to use this font.
    assert.match(string(await call('execute', { command: 'preflight.run' })), /missingGlyphs/);
    await call('execute', { command: 'document.preferences', params: { glyphFallback: true } });
    assert.doesNotMatch(string(await call('execute', { command: 'preflight.run' })), /missingGlyphs/);
    await call('execute', { command: 'document.preferences', params: { glyphFallback: false } });
    await call('execute', { command: 'text.select', params: { story: created.story, anchor: 0, focus: Buffer.byteLength(text) } });
    await call('execute', { command: 'type.char', params: { attrs: { fontFamily: 'LXGW WenKai', size: 32 } } });
    assert.doesNotMatch(string(await call('execute', { command: 'preflight.run' })), /missingGlyphs/);
    await call('execute', { command: 'text.exitToFrame' });
    await image(await call('render_page', { page: 0, scale: 1 }));
  } else if (name === 'deckcraft') {
    await call('new_presentation');
    await call('add_slide', { layout: 'titleAndContent', title: text, body: '中文正文，简体与繁體。' });
    assert.ok(string(await call('inspect_slide')).includes(text));
    await image(await call('render_slide', { scale: 1 }));
  } else if (name === 'cadcraft') {
    await call('new_drawing');
    await call('execute', { command: 'text', params: { at: [0, 0], text, height: 5 } });
    const first = await image(await call('render', { width: 640, height: 240 }));
    await call('new_drawing');
    await call('execute', { command: 'text', params: { at: [0, 0], text: '字体中文测试', height: 5 } });
    const second = await call('render', { width: 640, height: 240 });
    // Equal-length missing-glyph boxes would render identically even after
    // reordering the characters. Real Chinese glyphs must change the image.
    assert.notEqual(second.content.find(c => c.type === 'image')?.data, first, 'Chinese text rendered as identical missing-glyph boxes');
  } else if (name === 'soundcraft') {
    await call('new_session', { name: text, template: 'blank' });
    assert.ok(string(await call('inspect_session', { detail: 'full' })).includes(text));
  } else if (name === 'pdfcraft') {
    // Upstream doc_create(text) and page_add_text only accept WinAnsi. Adding a
    // font does not broaden those APIs; exercise Chinese UI metadata instead.
    const { doc } = json(await call('doc_create', { from: 'blank', name: `${text}.pdf` }));
    await call('doc_set_info', { doc, key: 'Title', value: text });
    assert.ok(string(await call('doc_info', { doc })).includes(text));
    await call('doc_save', { doc, path: 'chinese.pdf' });
    await image(await call('page_render', { doc, page: 1, dpi: 72 }));
    await copyFile(join(workspace, 'chinese.pdf'), join(output, 'pdfcraft-chinese.pdf'));
  }
  return { text, calls };
}
