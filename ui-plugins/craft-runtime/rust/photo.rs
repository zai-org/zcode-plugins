//! Browser implementation of the pinned PhotoCraft MCP contract, using the live UI session.
use serde_json::{Value, json};
use crate::PhotocraftApp;
use base64::Engine as _;

fn control(app: &mut PhotocraftApp, ctx: &egui::Context, method: &str, params: Value) -> Result<Value, String> {
    if method == "ui.screenshot" {
        let data=super::craft_bridge::host_screenshot().map_err(|e|format!("{e:?}"))?;
        if let Some(path)=params["path"].as_str() {
            super::craft_bridge::write(path,&base64::engine::general_purpose::STANDARD.decode(&data).map_err(|e|e.to_string())?)?;
        }
        return Ok(json!({"base64":data,"path":params.get("path")}));
    }
    let (request, _) = crate::control::ControlRequest::new(method, params);
    match crate::control::handle(app, ctx, &request) {
        crate::control::Outcome::Done(value) if value["ok"].as_bool() == Some(true) => Ok(value["result"].clone()),
        crate::control::Outcome::Done(value) => Err(value["error"].as_str().unwrap_or("Control failed").to_owned()),
        crate::control::Outcome::AfterInput => Ok(json!({"queued":true})),
        _ => Err("Operation is still pending; inspect jobs_list before retrying".into()),
    }
}
fn command(app: &mut PhotocraftApp, ctx: &egui::Context, id: &str, params: Value) -> Result<Value, String> {
    control(app, ctx, "engine.execute", json!({"command":id,"params":params}))
}
fn index(app: &PhotocraftApp, args: &Value) -> Result<usize, String> {
    let i = args["index"].as_u64().and_then(|v| usize::try_from(v).ok()).or(app.session.active_index()).ok_or("No document open")?;
    if i >= app.session.documents().len() { return Err("Document index out of bounds".into()); }
    Ok(i)
}
fn run(app: &mut PhotocraftApp, ctx: &egui::Context, name: &str, a: &Value) -> Result<Value, String> {
    let object = || a.as_object().cloned().unwrap_or_default();
    let string = |key: &str| a[key].as_str().ok_or_else(|| format!("Missing {key}"));
    match name {
        "__craft_saved" => {
            let i=index(app,a)?;
            let state=&app.session.documents()[i];
            if json!(state.doc.id)!=a["document"] { return Err("Saved document was closed or replaced".into()); }
            let previous=app.session.active_index();
            app.session.set_active(i);
            if let Some(state)=app.session.active_mut() {
                state.saved_to(string("path")?.to_owned());
                state.saved_revision=a["revision"].as_u64().ok_or("Missing saved revision")?;
            }
            if let Some(previous)=previous { app.session.set_active(previous); }
            Ok(json!({}))
        }
        "session_list" => Ok(photocraft_engine::inspect::session(&app.session)),
        "doc_open" => control(app,ctx,"app.open",a.clone()),
        "doc_new" => command(app,ctx,"file.new",a.clone()),
        "doc_select" => {
            if !app.session.set_active(index(app,a)?) { return Err("No such document".into()); }
            app.sync_views(); Ok(photocraft_engine::inspect::session(&app.session))
        }
        "doc_close" => {
            app.session.close(index(app,a)?); app.sync_views();
            Ok(photocraft_engine::inspect::session(&app.session))
        }
        "doc_inspect" => match index(app,a) {
            Ok(i) => Ok(photocraft_engine::inspect::document(&app.session.documents()[i])),
            Err(_) if a.get("index").is_none() && app.session.documents().is_empty() => Ok(json!({"document":null})),
            Err(e) => Err(e),
        },
        "doc_save" | "doc_export" => {
            if name=="doc_export" && a["path"].as_str().is_none() { return Err("doc_export needs path".into()); }
            let i=index(app,a)?; let state=&app.session.documents()[i];
            let path=a["path"].as_str().map(str::to_owned).or_else(||state.path.clone()).ok_or("Provide an output path")?;
            if a["path"].as_str().is_none() && !["psd","psb","pcraft"].iter().any(|ext|path.to_lowercase().ends_with(&format!(".{ext}"))) { return Err("Provide a new path for a flat export".into()); }
            let format=a["format"].as_str().map(str::to_owned).unwrap_or_else(||path.rsplit('.').next().unwrap_or("pcraft").to_ascii_lowercase());
            let mut options=photocraft_io::ExportOptions::default();
            if let Some(q)=a["quality"].as_u64() { options.encode.jpeg_quality=q.clamp(1,100) as u8; options.encode.webp_quality=q.clamp(1,100) as u8; options.encode.webp_lossless=false; }
            options.tiff_layers=a["tiffLayers"].as_bool().unwrap_or(false);
            if let Some(bits)=a["tgaBits"].as_u64() { options.tga_bits=Some(photocraft_io::TgaBits::from_bits(bits).ok_or("tgaBits must be 24 or 32")?); }
            let (bytes,warnings)=if format.trim_start_matches('.')=="pcraft" {
                let opts=photocraft_format::SaveOptions { thumbnail:Some(photocraft_compose::thumbnail(&state.doc,256)), composite:Some(photocraft_compose::thumbnail(&state.doc,1024)) };
                (photocraft_format::save_to_bytes(&state.doc,&opts).map_err(|e|e.to_string())?,Vec::<String>::new())
            } else {
                let result=photocraft_io::export(&state.doc,&format,&options).map_err(|e|e.to_string())?;
                (result.bytes,result.warnings)
            };
            super::craft_bridge::write(&path,&bytes)?;
            let commit=if name=="doc_save" && ["pcraft","psd","psb","ora"].contains(&format.as_str()) {
                json!({"index":i,"document":state.doc.id,"revision":state.revision,"path":path})
            } else {Value::Null};
            Ok(json!({"path":path,"bytes":bytes.len(),"warnings":warnings,"_craftSave":commit}))
        }
        "doc_place" | "doc_export_layers" | "doc_export_data_sets" | "doc_import_data_sets" => {
            if a.get("index").is_some() { app.session.set_active(index(app,a)?); }
            let id=match name { "doc_place"=>"file.placeEmbedded", "doc_export_layers"=>"file.export.layersToFiles", "doc_export_data_sets"=>"file.export.dataSetsAsFiles", _=>"file.import.variableDataSets" };
            let mut p=object(); p.remove("index");
            for (from,to) in [("visible_only","visibleOnly"),("data_sets","dataSets")] { if let Some(v)=p.remove(from) { p.insert(to.into(),v); } }
            command(app,ctx,id,Value::Object(p))
        }
        "command_list" => {
            let value=control(app,ctx,"engine.commands",json!({}))?;
            let filter=a["filter"].as_str().unwrap_or("").to_lowercase();
            let enabled=a["enabled_only"].as_bool().unwrap_or(false);
            let all=value.as_array().or_else(||value["commands"].as_array()).ok_or("Invalid command catalogue")?;
            Ok(Value::Array(all.iter().filter(|v|format!("{} {}",v["id"],v["label"]).to_lowercase().contains(&filter) && (!enabled||v["enabled"].as_bool().unwrap_or(true))).cloned().collect()))
        }
        "command_run" => control(app,ctx,"engine.execute",json!({"command":string("id")?,"params":a.get("params").cloned().unwrap_or(json!({})),"wait":a["wait"].as_bool().unwrap_or(true)})),
        "command_batch" => {
            let steps=a["steps"].as_array().ok_or("steps must be an array")?;
            if steps.len()>1000 { return Err("Batch exceeds 1000 steps".into()); }
            let mut results=Vec::new(); let mut failed=0;
            for step in steps {
                match run(app,ctx,"command_run",step) {
                    Ok(value)=>results.push(json!({"ok":true,"result":value})),
                    Err(e)=>{ failed+=1;results.push(json!({"ok":false,"error":e}));if a["stop_on_error"].as_bool().unwrap_or(true) { break; } }
                }
            }
            Ok(json!({"completed":results.len()-failed,"failed":failed,"results":results}))
        }
        "jobs_list" => control(app,ctx,"jobs.list",json!({})),
        "jobs_cancel" => control(app,ctx,"jobs.cancel",a.clone()),
        "ui_inspect" => control(app,ctx,"ui.inspect",json!({})),
        "ui_set" => control(app,ctx,"ui.set",a["fields"].clone()),
        "ui_pointer" => control(app,ctx,"ui.pointer",a.clone()),
        "ui_menu_invoke" => control(app,ctx,"ui.menu.invoke",json!({"id":string("id")?})),
        "control_call" => control(app,ctx,string("method")?,a.get("params").cloned().unwrap_or(json!({}))),
        _ => Err(format!("Unknown tool: {name}")),
    }
}
pub fn call(app: &mut PhotocraftApp, ctx: &egui::Context, name: &str, args: &Value) -> Value {
    if matches!(name,"render_preview"|"doc_render_preview"|"ui_screenshot") {
        let result=(|| -> Result<String,String> {
            if name=="ui_screenshot" { return super::craft_bridge::host_screenshot().map_err(|e|format!("{e:?}")); }
            let state=&app.session.documents()[index(app,args)?];
            let max=args["max_side"].as_u64().unwrap_or(1024);
            if max>2048 { return Err("Preview side exceeds 2048 pixels".into()); }
            let max=if max==0 {2048} else {max as u32};
            let thumb=photocraft_compose::thumbnail(&state.doc,max);
            let image=photocraft_codecs::Image::from_u8(thumb.width,thumb.height,photocraft_codecs::ChannelLayout::Rgba,thumb.pixels).map_err(|e|e.to_string())?;
            let png=photocraft_codecs::encode(&image,photocraft_codecs::Format::Png,&Default::default()).map_err(|e|e.to_string())?;
            Ok(base64::engine::general_purpose::STANDARD.encode(png))
        })();
        return match result { Ok(data)=>json!({"content":[{"type":"image","mimeType":"image/png","data":data}]}), Err(e)=>super::craft_bridge::error(e) };
    }
    match run(app,ctx,name,args) {
        Ok(mut value)=>{
            let commit=value.as_object_mut().and_then(|v|v.remove("_craftSave"));
            json!({"content":[{"type":"text","text":value.to_string()}],"isError":value["failed"].as_u64().unwrap_or(0)>0,"_craftSave":commit})
        },
        Err(e)=>super::craft_bridge::error(e),
    }
}
