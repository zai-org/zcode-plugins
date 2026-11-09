"""Apply the versioned live-editor overlay to an extracted, pinned upstream tree."""
from pathlib import Path
import sys
import re

runtime = Path(__file__).resolve().parent
root = Path(sys.argv[1])
name = sys.argv[2]

def replace(path, old, new):
    p = root / path
    s = p.read_text()
    if old not in s:
        raise RuntimeError(f'{name}: overlay anchor absent: {path}: {old[:100]}')
    p.write_text(s.replace(old, new, 1))

def dependency(path, key, value):
    p = root / path
    s = p.read_text()
    if re.search(r'^' + re.escape(key) + r'\s*=', s, re.M):
        return
    marker = '[target.\'cfg(target_arch = "wasm32")\'.dependencies]'
    line = f'{key} = {value}\n'
    if marker in s:
        s = s.replace(marker, marker + '\n' + line, 1)
    else:
        s += '\n' + marker + '\n' + line
    p.write_text(s)

def file_bridge():
    # Keep native behavior intact. Browser reads/writes can only access bytes explicitly
    # provided for the current MCP operation, and all outputs are committed by the host.
    for crate in (root/'crates').iterdir():
        lib = crate/'src/lib.rs'
        if not lib.exists():
            continue
        changed = False
        for p in (crate/'src').rglob('*.rs'):
            s = p.read_text()
            new = re.sub(r'std::fs::(read_to_string|read|write|create_dir_all)\(', r'crate::craft_fs::\1(', s)
            if new != s:
                p.write_text(new)
                changed = True
        if changed:
            lib.write_text(lib.read_text()+'\n#[allow(unused_imports, dead_code)]\npub(crate) mod craft_fs;\n')
            (crate/'src/craft_fs.rs').write_text((runtime/'rust/fs.rs').read_text())
            dependency(str(crate.relative_to(root)/'Cargo.toml'),'wasm-bindgen','"0.2"')
            dependency(str(crate.relative_to(root)/'Cargo.toml'),'js-sys','"0.3"')

file_bridge()
if name == 'photocraft':
    path='crates/engine/src/file_cmds.rs'
    replace(path, 'if cfg!(target_arch = "wasm32") { Err("not available on the web (no file system)".into()) } else { Ok(()) }', 'Ok(())')
    replace(path, 'fn is_file(_path: &str) -> bool {\n    false\n}', 'fn is_file(path: &str) -> bool { crate::craft_fs::read(path).is_ok() }')
    replace(path, 'Err(EngineError::Other(format!("cannot read {path}: no file system on the web")))', 'crate::craft_fs::read(path).map_err(|e| EngineError::Other(e.to_string()))')
    replace(path, 'pub(crate) fn write_file(path: &str, _bytes: &[u8])', 'pub(crate) fn write_file(path: &str, bytes: &[u8])')
    replace(path, 'Err(EngineError::Other(format!("cannot write {path}: no file system on the web")))', 'crate::craft_fs::write(path,bytes).map_err(|e| EngineError::Other(e.to_string()))')
    replace(path, 'Err(EngineError::Other(format!("cannot list {dir}: no file system on the web")))', 'crate::craft_fs::list(dir).map(|paths| paths.into_iter().filter(|p| extension(p).is_some_and(|e| OPENABLE.contains(&e.as_str()))).collect()).map_err(|e| EngineError::Other(e.to_string()))')
    replace(path, '#[cfg(not(target_arch = "wasm32"))]\nconst OPENABLE', 'const OPENABLE')
if name == 'soundcraft':
    path='crates/engine/src/io.rs'
    anchor='pub fn open_session(e: &mut Engine, path: &str) -> Result<Vec<String>> {'
    replace(path,anchor,anchor+'''\n    #[cfg(target_arch = "wasm32")]
    { let bytes=crate::craft_fs::read(path).map_err(|e| EngineError::Io(e.to_string()))?;
      if bytes.starts_with(b"PK") { return open_session_bytes(e,path,&bytes); } }
''')
if name == 'pdfcraft':
    path='crates/automation/src/lib.rs'
    replace(path, 'let file = std::fs::File::open(&path).map_err(failed)?;', 'let file = std::io::Cursor::new(crate::craft_fs::read(&path).map_err(failed)?);')
    replace(path, 'fn write_atomic(path: &Path, bytes: &[u8]) -> Result<()> {', '#[cfg(not(target_arch = "wasm32"))]\nfn write_atomic(path: &Path, bytes: &[u8]) -> Result<()> {')
    p=root/path;p.write_text(p.read_text()+'\n#[cfg(target_arch = "wasm32")]\nfn write_atomic(path: &Path, bytes: &[u8]) -> Result<()> { crate::craft_fs::write(path,bytes).map_err(failed) }\n')
if name == 'designcraft':
    p=root/'crates/mcp/src/tools.rs';s=p.read_text();start=s.index('fn screenshot(');end=s.index('\nfn pointer(',start)
    s=s[:start]+'''fn screenshot(b: &mut dyn Backend, a: &Args) -> Result<ToolResult, String> {
    need_ui(b, "screenshot")?;
    let r=b.call("ui.screenshot",Value::Object(a.clone()))?;
    Ok(ToolResult::image(r["png"].as_str().ok_or("Screenshot is missing")?.to_owned(), &json!({"path":a.get("path")})))
}
'''+s[end:];p.write_text(s)
if name == 'vectorcraft':
    replace('crates/mcp/src/headless.rs','vectorcraft_format::write_atomic(std::path::Path::new(path), &png)',
            'crate::craft_fs::write(std::path::Path::new(path), &png)')
if name == 'gridcraft':
    replace('crates/engine/src/io.rs', 'Err(EngineError::Other(format!("{path}: no file system in the browser")))',
            'crate::craft_fs::read(path).map_err(|e| EngineError::Other(e.to_string()))')
    replace('crates/engine/src/io.rs', 'pub fn write_file(path: &str, _bytes: &[u8])', 'pub fn write_file(path: &str, bytes: &[u8])')
    replace('crates/engine/src/io.rs', 'Err(EngineError::Other(format!("{path}: no file system in the browser")))',
            'crate::craft_fs::write(path, bytes).map_err(|e| EngineError::Other(e.to_string()))')
if name == 'wordcraft':
    replace('crates/engine/src/io.rs', 'Err(format!("{}: files are opened through the browser on the web", path.display()))',
            'open_bytes_with(&path.to_string_lossy(), &crate::craft_fs::read(path).map_err(|e| e.to_string())?, _password)')
    replace('crates/engine/src/io.rs', 'Err(format!("{}: files are saved through the browser on the web", path.display()))',
            'crate::craft_fs::write(path, save_bytes_with(&path.to_string_lossy(), _doc, _password, _opts)?).map_err(|e| e.to_string())')

if name == 'pdfcraft':
    dependency('crates/ui-egui/Cargo.toml','pdfcraft-automation','{ path = "../automation", default-features = false }')
    for key, val in [('wasm-bindgen','"0.2"'),('js-sys','"0.3"'),('base64','"0.22"')]:
        dependency('crates/ui-egui/Cargo.toml',key,val)
    p=root/'crates/ui-egui/src/lib.rs'
    p.write_text(p.read_text()+'\n#[cfg(target_arch = "wasm32")]\nmod craft_bridge;\n')
    anchor='fn logic(&mut self, ctx: &egui::Context, _frame: &mut eframe::Frame) {'
    replace('crates/ui-egui/src/lib.rs',anchor,anchor+'\n        #[cfg(target_arch = "wasm32")]\n        craft_bridge::pump(self, ctx);')
    addition='''
impl Automation {
    pub fn craft_call(&mut self, session: &mut Session, name: &str, args: &Value) -> Result<Vec<Content>> {
        std::mem::swap(&mut self.session, session);
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| self.call(name, args)));
        std::mem::swap(&mut self.session, session);
        result.unwrap_or_else(|_| Err(failed("Tool panicked; inspect the document before retrying")))
    }
}
pub fn craft_catalog() -> Value {
    Value::Array(tools().into_iter().map(|t| json!({"name":t.name,"title":t.title,"description":t.description,
        "inputSchema":t.input_schema,"annotations":{"readOnlyHint":t.read_only,"destructiveHint":t.destructive,
        "openWorldHint":false}})).collect())
}
'''
    p=root/'crates/automation/src/lib.rs';p.write_text(p.read_text()+addition)
    template=(runtime/'rust/bridge.rs.in').read_text()
    start=template.index("struct Live<'a>");end=template.index('pub(crate) fn pump',start)
    template=template[:start]+(runtime/'rust/pdf.rs.in').read_text()+'\n'+template[end:]
    for key,value in {'APP':'PdfCraftApp','BUSY':'false','CATALOG':'pdfcraft_automation::craft_catalog()',
                      'CALL':'backend.call(name, &args)','SERVICES_BEGIN':'','SERVICES_END':''}.items():
        template=template.replace('__'+key+'__',value)
    (root/'crates/ui-egui/src/craft_bridge.rs').write_text(template)
    sys.exit(0)

if name == 'photocraft':
    for key,val in [('wasm-bindgen','"0.2"'),('js-sys','"0.3"'),('schemars','"1"')]:
        dependency('crates/ui-egui/Cargo.toml',key,val)
    p=root/'crates/ui-egui/src/lib.rs'
    p.write_text(p.read_text()+'\n#[cfg(target_arch = "wasm32")]\nmod craft_bridge;\n#[cfg(target_arch = "wasm32")]\nmod craft_tools;\n')
    anchor='fn logic(&mut self, ctx: &egui::Context, frame: &mut eframe::Frame) {'
    replace('crates/ui-egui/src/lib.rs',anchor,anchor+'\n        #[cfg(target_arch = "wasm32")]\n        craft_bridge::pump(self, ctx);')
    source=(root/'crates/automation/src/server.rs').read_text()
    declarations=source[source.index('#[derive(Debug, Default, Deserialize, JsonSchema)]'):source.index('// Helpers')]
    declarations=declarations[:declarations.rfind('// ---------------------------------------------------------------------------')]
    tools=[]
    for m in re.finditer(r'#\[tool\(\s*description\s*=\s*("(?:\\.|[^"\\])*")\s*\)\]\s*async fn\s+(\w+)\((.*?)\)\s*->',source,re.S):
        description,tool,signature=m.groups()
        typ=re.search(r'Parameters<(\w+)>',signature)
        schema=f'json!(schemars::schema_for!({typ.group(1)}))' if typ else 'json!({"type":"object","properties":{},"additionalProperties":false})'
        readonly=tool in ['session_list','doc_inspect','doc_render_preview','render_preview','command_list','jobs_list','ui_inspect','ui_screenshot']
        tools.append(f'json!({{"name":"{tool}","description":{description},"inputSchema":{schema},"annotations":{{"readOnlyHint":{str(readonly).lower()},"destructiveHint":{str(not readonly).lower()},"openWorldHint":false}}}})')
    if len(tools)!=25: raise RuntimeError(f'PhotoCraft catalogue extraction returned {len(tools)} tools')
    code=(runtime/'rust/photo.rs').read_text()+'\nuse serde::Deserialize;\nuse schemars::JsonSchema;\n'+declarations
    code+='\npub fn catalog() -> Value { json!(['+','.join(tools)+']) }\n'
    (root/'crates/ui-egui/src/craft_tools.rs').write_text(code)
    template=(runtime/'rust/bridge.rs.in').read_text().replace('impl __MCP__::Backend for Live', 'impl Live')
    control='''let (request, _) = crate::control::ControlRequest::new(method,params);
        match crate::control::handle(self.app,self.ctx,&request) {
            crate::control::Outcome::Done(v) => unwrap_control(v),
            _ => Err("Operation pending; inspect jobs_list".into()),
        }'''
    begin='''let old_read=app.services.automation_read.replace(Box::new(|path| Ok((path.to_owned(),read(path)?))));
        let old_write=app.services.automation_write.replace(Box::new(write));'''
    end='''backend.app.services.automation_read=old_read;
        backend.app.services.automation_write=old_write;'''
    for key,value in {'APP':'PhotocraftApp','BUSY':'!app.synthetic.is_empty()','CATALOG':'crate::craft_tools::catalog()', 'CONTROL':control,
                      'CALL':'crate::craft_tools::call(backend.app,backend.ctx,name,&args)',
                      'SERVICES_BEGIN':begin,'SERVICES_END':end}.items():
        template=template.replace('__'+key+'__',value)
    (root/'crates/ui-egui/src/craft_bridge.rs').write_text(template)
    sys.exit(0)

apps = {'vectorcraft':'VectorcraftApp', 'designcraft':'DesignApp', 'wordcraft':'WordApp',
        'gridcraft':'SheetApp', 'deckcraft':'SlideApp', 'cadcraft':'CadApp', 'soundcraft':'SoundApp'}
if name not in apps:
    raise RuntimeError(f'Overlay not implemented: {name}')
app = apps[name]
mcp = name + ('_automation' if name == 'soundcraft' else '_mcp')
dep = 'automation' if name == 'soundcraft' else 'mcp'
dependency('crates/ui-egui/Cargo.toml',mcp.replace('_','-'),f'{{ path = "../{dep}" }}')
dependency('crates/ui-egui/Cargo.toml','wasm-bindgen','"0.2"')
dependency('crates/ui-egui/Cargo.toml','js-sys','"0.3"')
dependency('crates/ui-egui/Cargo.toml','base64','"0.22"')
ui = 'crates/ui-egui/src/lib.rs'
replace(ui, 'pub mod control;', '#[cfg(target_arch = "wasm32")]\nmod craft_bridge;\npub mod control;')
anchor = 'pub fn logic(&mut self, ctx: &egui::Context) {'
replace(ui, anchor, anchor+'\n        #[cfg(target_arch = "wasm32")]\n        craft_bridge::pump(self, ctx);')
control = '''let (req, _) = crate::control::ControlRequest::new(method, params);
        match crate::control::handle(self.app, self.ctx, &req) {
            crate::control::Outcome::Done(value) => unwrap_control(value),
            _ => Err("Deferred window operation is unavailable in the embedded editor".into()),
        }'''
catalog = f'serde_json::json!({mcp}::tool_definitions())'
call = f'{mcp}::call_tool(&mut backend, name, &args).to_value()'
if name == 'gridcraft':
    control = control.replace('crate::control::handle(self.app, self.ctx, &req)', 'crate::control::handle(self.app, self.ctx, &req.method, &req.params)')
if name == 'wordcraft':
    catalog = f'{mcp}::tools::tool_definitions()'
    call = f'{mcp}::tools::call_tool(&mut backend, name, &args).to_value()'
elif name == 'cadcraft':
    replace('crates/mcp/src/lib.rs','mod tools;','pub mod tools;')
    catalog = f'{mcp}::tools::tool_definitions(true)["tools"]'
    call = f'{mcp}::tools::call_tool(&mut backend, name, &args).unwrap_or_else(error)'
elif name == 'soundcraft':
    replace('crates/ui-egui/src/control.rs','fn handle(app:', 'pub(crate) fn handle(app:')
    control = '''let (req, _) = crate::control::ControlRequest::new(method, params);
        crate::control::handle(self.app, self.ctx, &req).ok_or_else(|| "Deferred window operation".to_owned()).and_then(unwrap_control)'''
    catalog = f'json!({mcp}::mcp::tool_definitions())'
    call = f'{mcp}::mcp::Server::new(backend).call_tool(name, &args)'
begin = end = ''
if name in ['vectorcraft','designcraft','deckcraft']:
    begin = '''let old_read = app.services.read.replace(Box::new(read));
        let old_write = app.services.write.replace(Box::new(write));
        let old_download = app.services.download.take();'''
    end = '''backend.app.services.read = old_read;
        backend.app.services.write = old_write;
        backend.app.services.download = old_download;'''
template = (runtime/'rust/bridge.rs.in').read_text()
for key, value in {'APP':app,'BUSY':'!app.synthetic.is_empty()','MCP':mcp,'CATALOG':catalog,'CONTROL':control,'CALL':call,
                   'SERVICES_BEGIN':begin,'SERVICES_END':end}.items():
    template = template.replace('__'+key+'__',value)
(root/'crates/ui-egui/src/craft_bridge.rs').write_text(template)
