import assert from 'node:assert/strict';
import { readFile, writeFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

export const counts = { photocraft:25, vectorcraft:32, pdfcraft:159, designcraft:25, wordcraft:16, gridcraft:21, deckcraft:25, cadcraft:14, soundcraft:17 };
export async function automationSmoke({ client, frame, name, workspace, catalogPath }) {
  await frame.waitForFunction(() => window.__craftPlugin.automationReady || window.__craftPlugin.error, null, { timeout:30000 });
  assert.equal(await frame.evaluate(() => window.__craftPlugin.error), null);
  const catalog = JSON.parse(await readFile(catalogPath,'utf8'));
  const listed = (await client.listTools()).tools;
  assert.equal(catalog.length, counts[name]);
  for (const tool of catalog) assert.ok(listed.some(t => t.name === tool.name), tool.name);
  assert.deepEqual(await frame.evaluate(() => window.__craftPlugin.tools.map(t=>t.name)), catalog.map(t=>t.name));
  for (const hidden of listed.filter(t=>t.name.startsWith('_editor_'))) assert.deepEqual(hidden._meta.ui.visibility,['app']);
  const calls = [];
  async function call(tool,args={}) {
    if (process.env.CRAFT_TRACE) console.log(`MCP ${name}.${tool}`);
    const result = await client.callTool({name:tool,arguments:args}, undefined, {timeout:150000});
    calls.push(tool);
    assert.ok(!result.isError, `${name}.${tool}: ${JSON.stringify(result).slice(0,1500)}`);
    return result;
  }
  const string = r => r.content.filter(c=>c.type==='text').map(c=>c.text).join('\n');
  const json = r => JSON.parse(r.content.find(c=>c.type==='text').text);
  if (name === 'gridcraft') {
    await call('new_workbook');
    await call('set_cell',{cell:'A1',input:'MCP persisted 42'});
    assert.match(string(await call('read_range',{range:'A1'})), /MCP persisted 42/);
    await call('undo');
    assert.doesNotMatch(string(await call('read_range',{range:'A1'})), /MCP persisted 42/);
    await call('redo');
    await call('save_workbook',{path:'mcp/grid.xlsx'});
    assert.ok((await stat(join(workspace,'mcp/grid.xlsx'))).size>100);
    await call('new_workbook');
    await call('open_workbook',{path:'mcp/grid.xlsx'});
    assert.match(string(await call('read_range',{range:'A1'})), /MCP persisted 42/);
    await call('screenshot',{path:'mcp/grid.png'});
    const screenshot=await readFile(join(workspace,'mcp/grid.png'));
    assert.equal(screenshot.subarray(1,4).toString(),'PNG');
    assert.ok(screenshot.length>10000,'Screenshot should contain the rendered UI');
    const invalid=await client.callTool({name:'execute_command',arguments:{command:'nonexistent.craft.command'}});
    assert.equal(invalid.isError,true);
  }
  if (name === 'wordcraft') {
    await call('new_document');
    await call('type_text',{text:'MCP persisted 42'});
    assert.match(string(await call('get_text')),/MCP persisted 42/);
    await call('save_document',{path:'mcp/word.docx'});
    await call('new_document');
    await call('open_document',{path:'mcp/word.docx'});
    assert.match(string(await call('get_text')),/MCP persisted 42/);
    await call('render_page',{page:1});
  }
  if (name === 'deckcraft') {
    await call('new_presentation');
    await call('add_slide',{layout:'titleAndContent',title:'MCP persisted 42',body:'Saved by real MCP'});
    assert.match(string(await call('inspect_slide')),/MCP persisted 42/);
    await call('save_presentation',{path:'mcp/deck.pptx'});
    await call('new_presentation');
    await call('open_presentation',{path:'mcp/deck.pptx'});
    assert.match(string(await call('inspect_document')),/MCP persisted 42/);
  }
  if (name === 'designcraft') {
    await call('new_document',{pages:1,title:'MCP persisted 42'});
    const created=json(await call('execute',{command:'frame.create',params:{rect:[36,36,400,100],content:'text',text:'MCP persisted 42'}}));
    assert.match(string(await call('get_story',{story:created.story})),/MCP persisted 42/);
    await call('save_document',{path:'mcp/layout.designcraft'});
    await call('new_document');
    await call('open_document',{path:'mcp/layout.designcraft'});
    assert.match(string(await call('inspect_document')),/MCP persisted 42/);
    await call('render_page',{page:0,scale:0.5});
  }
  if (name === 'vectorcraft') {
    await call('run_command',{command:'file.new',params:{width:200,height:200}});
    await call('draw_shape',{shape:'rectangle',x:20,y:30,width:100,height:60,fill:'#ff0000'});
    const before=string(await call('inspect_document'));
    assert.match(before,/100/);
    await call('save_file',{path:'mcp/vector.vectorcraft'});
    await call('run_command',{command:'file.new',params:{width:100,height:100}});
    await call('open_file',{path:'mcp/vector.vectorcraft'});
    assert.match(string(await call('inspect_document')),/100/);
    await call('screenshot',{scale:0.5});
  }
  if (name === 'cadcraft') {
    await call('new_drawing');
    await call('execute',{command:'circle',params:{center:[12,24],radius:5}});
    assert.equal(json(await call('query_entities',{type:'Circle'})).count,1);
    await call('save',{path:'mcp/drawing.dxf'});
    await call('new_drawing');
    await call('open',{path:'mcp/drawing.dxf'});
    assert.equal(json(await call('query_entities',{type:'Circle'})).count,1);
    await call('render',{width:320,height:240});
  }
  if (name === 'soundcraft') {
    await call('new_session',{name:'MCP persisted 42',template:'blank'});
    assert.match(string(await call('inspect_session',{detail:'full'})),/MCP persisted 42/);
    const samples=4800, wave=Buffer.alloc(44+samples*2);
    wave.write('RIFF',0);wave.writeUInt32LE(wave.length-8,4);wave.write('WAVEfmt ',8);
    wave.writeUInt32LE(16,16);wave.writeUInt16LE(1,20);wave.writeUInt16LE(1,22);
    wave.writeUInt32LE(48000,24);wave.writeUInt32LE(96000,28);wave.writeUInt16LE(2,32);wave.writeUInt16LE(16,34);
    wave.write('data',36);wave.writeUInt32LE(samples*2,40);
    for(let i=0;i<samples;i++) wave.writeInt16LE(Math.round(Math.sin(i*2*Math.PI*440/48000)*10000),44+i*2);
    await writeFile(join(workspace,'tone.wav'),wave);
    await call('import_audio',{path:'tone.wav'});
    await call('bounce_mix',{path:'mcp/mix.wav',format:'wav'});
    assert.equal((await readFile(join(workspace,'mcp/mix.wav'))).subarray(0,4).toString(),'RIFF');
    await call('save_session',{path:'mcp/sound.scraftz'});
    assert.ok((await stat(join(workspace,'mcp/sound.scraftz'))).size>100);
    await call('new_session');
    await call('open_session',{path:'mcp/sound.scraftz'});
    assert.match(string(await call('inspect_session',{detail:'full'})),/sound/);
  }
  if (name === 'photocraft') {
    await call('doc_new',{width:64,height:48,name:'MCP persisted 42',background:'white'});
    await call('command_run',{id:'layer.new.layer',params:{name:'MCP layer'}});
    assert.match(string(await call('doc_inspect')),/MCP layer/);
    await call('doc_save',{path:'mcp/photo.pcraft'});
    await call('doc_close');
    await call('doc_open',{path:'mcp/photo.pcraft'});
    assert.match(string(await call('doc_inspect')),/MCP layer/);
    await call('doc_export',{path:'mcp/photo.png'});
    await call('doc_export_layers',{dir:'mcp/layers'});
    await call('render_preview',{max_side:64});
  }
  if (name === 'pdfcraft') {
    const created=json(await call('doc_create',{from:'text',text:'MCP persisted 42',name:'MCP test'}));
    const doc=created.doc;
    assert.ok(doc,JSON.stringify(created));
    await call('doc_set_info',{doc,key:'Title',value:'MCP persisted 42'});
    await call('doc_save',{doc,path:'mcp/document.pdf'});
    await call('doc_close',{doc});
    const reopened=json(await call('doc_open',{path:'mcp/document.pdf'}));
    assert.match(string(await call('doc_info',{doc:reopened.doc})),/MCP persisted 42/);
    await call('page_render',{doc:reopened.doc,page:1,dpi:36});
    await call('doc_print',{doc:reopened.doc,path:'mcp/print-ready.pdf'});
    assert.equal((await readFile(join(workspace,'mcp/print-ready.pdf'))).subarray(0,5).toString(),'%PDF-');
  }
  const inspectUI=['ui_inspect','inspect_ui'].find(tool=>catalog.some(t=>t.name===tool));
  if(inspectUI) await call(inspectUI);
  if(name !== 'gridcraft' && name !== 'pdfcraft') {
    const screenshot=catalog.some(t=>t.name==='ui_screenshot')?'ui_screenshot':'screenshot';
    await call(screenshot, name==='photocraft'?{max_side:128}:{});
  }
  assert.ok(calls.length >= 6, `${name}: missing live-edit test`);
  return {tools:catalog.length,calls};
}
