//! Font fallback for the ZCode Web distribution. Native behavior is unchanged.
pub(crate) fn definitions(mut fonts: egui::FontDefinitions) -> egui::FontDefinitions {
    #[cfg(target_arch = "wasm32")]
    {
        const NAME: &str = "LXGW WenKai";
        fonts.font_data.entry(NAME.into()).or_insert_with(|| {
            std::sync::Arc::new(egui::FontData::from_static(include_bytes!(env!("CRAFT_CJK_FONT"))))
        });
        for family in fonts.families.values_mut() {
            if !family.iter().any(|name| name == NAME) {
                family.push(NAME.into());
            }
        }
        fonts.families.entry(egui::FontFamily::Name(NAME.into())).or_insert_with(|| vec![NAME.into()]);
    }
    fonts
}
