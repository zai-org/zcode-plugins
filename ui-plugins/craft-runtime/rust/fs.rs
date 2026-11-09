//! Explicit file bytes supplied by the MCP host; no ambient browser filesystem.
pub use std::fs::*;

#[cfg(target_arch = "wasm32")]
mod browser {
    use std::io::{Error, ErrorKind, Result};
    use std::path::Path;
    use wasm_bindgen::prelude::*;
    #[wasm_bindgen]
    extern "C" {
        #[wasm_bindgen(catch, js_namespace = globalThis, js_name = __craftRead)]
        fn host_read(path: &str) -> std::result::Result<js_sys::Uint8Array, JsValue>;
        #[wasm_bindgen(catch, js_namespace = globalThis, js_name = __craftWrite)]
        fn host_write(path: &str, bytes: &[u8]) -> std::result::Result<(), JsValue>;
        #[wasm_bindgen(catch, js_namespace = globalThis, js_name = __craftList)]
        fn host_list(path: &str) -> std::result::Result<js_sys::Array, JsValue>;
        #[wasm_bindgen(catch, js_namespace = globalThis, js_name = __craftMkdir)]
        fn host_mkdir(path: &str) -> std::result::Result<(), JsValue>;
    }
    pub fn list(path: &str) -> Result<Vec<String>> {
        host_list(path).map(|a| a.iter().filter_map(|v| v.as_string()).collect()).map_err(|e| Error::new(ErrorKind::NotFound,format!("{e:?}")))
    }
    pub fn create_dir_all(path: impl AsRef<Path>) -> Result<()> {
        host_mkdir(&path.as_ref().to_string_lossy()).map_err(|e| Error::new(ErrorKind::Other,format!("{e:?}")))
    }
    pub fn read(path: impl AsRef<Path>) -> Result<Vec<u8>> {
        host_read(&path.as_ref().to_string_lossy()).map(|v| v.to_vec()).map_err(|e| Error::new(ErrorKind::NotFound, format!("{e:?}")))
    }
    pub fn read_to_string(path: impl AsRef<Path>) -> Result<String> {
        String::from_utf8(read(path)?).map_err(|e| Error::new(ErrorKind::InvalidData,e))
    }
    pub fn write(path: impl AsRef<Path>, bytes: impl AsRef<[u8]>) -> Result<()> {
        host_write(&path.as_ref().to_string_lossy(), bytes.as_ref()).map_err(|e| Error::new(ErrorKind::Other, format!("{e:?}")))
    }
}
#[cfg(target_arch = "wasm32")]
pub use browser::{read, read_to_string, write, create_dir_all, list};
