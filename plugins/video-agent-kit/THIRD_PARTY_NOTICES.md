# Third-party notices

`video-agent-kit` is licensed under the MIT License (see [LICENSE](LICENSE)). It also ships or downloads the third-party material listed below, which remains under its own license.

## CAM++ speaker-verification network (Apache-2.0)

- **Files:** `mcp/ve_tools/campplus_net.py`, `mcp/ve_tools/campplus_numpy.py`
- **Upstream:** [ModelScope](https://github.com/modelscope/modelscope), `modelscope/models/audio/sv/DTDNN.py` and `DTDNN_layers.py`
- **Copyright:** Copyright (c) Alibaba, Inc. and its affiliates. Upstream also notes that parts are adapted from [D-TDNN](https://github.com/yuyq96/D-TDNN); that attribution is kept in the source.
- **License:** Apache License 2.0. The full text is in [LICENSES/Apache-2.0.txt](LICENSES/Apache-2.0.txt).
- **Modifications by Z.ai:**
  - `campplus_net.py` keeps only the `nn.Module` network classes. The ModelScope framework wrapper, the CUDA torchaudio feature extension and the training code are removed.
  - `campplus_numpy.py` is a NumPy re-implementation of the same forward pass. It runs the published weights without torch.

## CAM++ model weights (Apache-2.0, downloaded on demand)

- **Model:** [`iic/speech_campplus_sv_zh-cn_16k-common`](https://modelscope.cn/models/iic/speech_campplus_sv_zh-cn_16k-common) on ModelScope, file `campplus_cn_common.bin`
- **License:** Apache License 2.0
- **Distribution:** the weights are not included in this plugin. The voice-card check downloads them once on first use into `<VE_STATE_HOME or ~/.video_agent>/models`. `VE_SPEAKER_CAMPP_WEIGHTS` can point at a local copy and `VE_MODELSCOPE_ENDPOINT` at a mirror.

## shadcn/ui components (MIT)

- **Files:** `skills/web-replicate/templates/default/template/src/components/ui/*` and `skills/web-replicate/templates/default-3d/template/src/components/ui/*`
- **Upstream:** [shadcn/ui](https://github.com/shadcn-ui/ui)
- **License:** MIT License, Copyright (c) 2023 shadcn
- **Use:** scaffold source copied into a user's project when a web page is replicated. npm dependencies of the templates are installed from the npm registry under their own licenses and are not bundled.
