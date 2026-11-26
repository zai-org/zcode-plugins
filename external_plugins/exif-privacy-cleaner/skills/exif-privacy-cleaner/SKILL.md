---
name: exif-privacy-cleaner
description: 分享照片前，先看看照片里藏了什么——GPS 位置、手机或相机型号、拍摄时间、软件、备注、XMP/IPTC 和 PNG 文本——然后导出清除了这些信息（或只清除位置）的副本。JPEG、PNG、WebP 不重新压缩，画质不变、颜色不变，竖拍照片也不会变横。原图绝不改动。在本地运行，无需 API 密钥。 用户提到“去掉照片定位 / 清除 EXIF / 照片隐私 / 发图前去元数据 / 拍摄地点泄露”时使用。
---

# 照片隐私信息清除

1. `exifclean_open(inputs, settings?, project?)`：扫描照片里的位置、相机、时间等隐藏信息。inputs 是工作区相对路径。
   - 结果里有汇总、问题列表（错误 / 提醒）和前几行数据，每行有编号 `#n`。
   - inputs 传文件夹（也可以直接传图片路径）；只去位置用 settings: {mode: "gps"}。
2. 向用户简要说明结果，先说错误和需要确认的地方，不要逐行念。
3. 用户要改时调用 `exifclean_edit(project, settings?, set?: [{row, values}], add?, remove?)`。
   - 不处理某张：`set: [{row, values: {clean: false}}]`。
4. `exifclean_export(project, formats?)`：导出清理后的副本（插件输出文件夹，或原图旁边的 文件名-clean.jpg）和 privacy-report.csv。把文件路径告诉用户。
5. 告诉用户哪些照片有 GPS（看 _gps 列）。清理后的是副本，原图仍含元数据，分享时要发副本。
