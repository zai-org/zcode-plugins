"""CAM++ speaker embeddings in numpy: the forward pass of campplus_net.CAMPPlus without torch.

The container scores voices with an ONNX export of ModelScope's
iic/speech_campplus_sv_zh-cn_16k-common weights, mounted at /opt/video_edit_models. A
plugin host (ZCode on a laptop) has neither that mount nor torch, so this module runs the
same network from the published weights file, campplus_cn_common.bin: the speaker check
then needs numpy and one 28 MB download (model_store fetches it on first use).

The thresholds in audio_identity were calibrated on the ONNX path. This one reproduces it to
float32 rounding — on 20 voice cards and take speech clips of upd-short-361 the embeddings
agree within 5e-6 relative and the 190 pairwise cosines within 1e-6 (the fail/ok band is
0.09 wide) — so the same ruler applies.

The checkpoint is a torch zip archive (data.pkl + one raw buffer per tensor). It is read with
an unpickler that admits only the names a state dict uses — OrderedDict, _rebuild_tensor_v2
and the storage types — so a file asking for anything else is refused rather than executed.

Layer layout, from campplus_net.py (modelscope DTDNN, Apache-2.0):
  head  FCM: conv3x3 -> 2 x 2 residual blocks (stride 2 on frequency) -> conv(2,1) -> 320 x T
  xvector: TDNN k5/s2 -> CAM dense blocks (12, 24, 16 layers; growth 32; dilation 1, 2, 2)
           with transit halvings -> BN-ReLU -> mean+std pooling -> 1x1 dense to 192 -> BN

License: derived from ModelScope's DTDNN (Apache-2.0, Copyright (c) Alibaba, Inc. and its
affiliates); see LICENSES/Apache-2.0.txt and THIRD_PARTY_NOTICES.md at the plugin root.
Modified by Z.ai: a NumPy re-implementation of the forward pass of campplus_net.CAMPPlus.
"""
from __future__ import annotations

import collections
import pickle
import zipfile
from pathlib import Path

import numpy as np

BN_EPS = 1e-5            # torch BatchNorm default; the checkpoint was trained with it
SEG_LEN = 100            # CAMLayer.seg_pooling window, in frames after the stride-2 TDNN
BLOCKS = ((12, 1), (24, 2), (16, 2))   # (layers, dilation) of block1..3; kernel 3 throughout
EMBEDDING_DIM = 192

_STORAGES = {
    "FloatStorage": np.float32, "DoubleStorage": np.float64, "HalfStorage": np.float16,
    "LongStorage": np.int64, "IntStorage": np.int32, "ShortStorage": np.int16,
    "CharStorage": np.int8, "ByteStorage": np.uint8, "BoolStorage": np.bool_,
}


def _rebuild_tensor(storage, offset, size, stride, *_rest):
    item = storage.itemsize
    return np.lib.stride_tricks.as_strided(
        storage[offset:], shape=tuple(size), strides=tuple(s * item for s in stride)).copy()


class _StateDictUnpickler(pickle.Unpickler):
    def __init__(self, fh, archive: zipfile.ZipFile, prefix: str, byteorder: str):
        super().__init__(fh)
        self._archive, self._prefix, self._order = archive, prefix, byteorder

    def find_class(self, module, name):
        if (module, name) == ("collections", "OrderedDict"):
            return collections.OrderedDict
        if (module, name) == ("torch._utils", "_rebuild_tensor_v2"):
            return _rebuild_tensor
        if module == "torch" and name in _STORAGES:
            return _STORAGES[name]
        raise pickle.UnpicklingError(f"checkpoint asks for {module}.{name}; only tensors are read")

    def persistent_load(self, pid):
        if not (isinstance(pid, tuple) and len(pid) == 5 and pid[0] == "storage"):
            raise pickle.UnpicklingError(f"unexpected persistent id {pid!r}")
        _kind, dtype, key, _location, numel = pid
        buf = self._archive.read(f"{self._prefix}data/{key}")
        return np.frombuffer(buf, dtype=np.dtype(dtype).newbyteorder(self._order), count=numel)


def load_state_dict(path: str | Path) -> dict[str, np.ndarray]:
    """Tensors of a torch zip checkpoint as numpy arrays, without importing torch."""
    with zipfile.ZipFile(path) as archive:
        pkl = next((n for n in archive.namelist() if n.endswith("/data.pkl") or n == "data.pkl"), None)
        if pkl is None:
            raise ValueError(f"{path} is not a torch zip checkpoint (no data.pkl)")
        prefix = pkl[: -len("data.pkl")]
        order = "<"
        if f"{prefix}byteorder" in archive.namelist():
            order = "<" if archive.read(f"{prefix}byteorder").strip() == b"little" else ">"
        with archive.open(pkl) as fh:
            state = _StateDictUnpickler(fh, archive, prefix, order).load()
    if not isinstance(state, dict):
        raise ValueError(f"{path} holds {type(state).__name__}, not a state dict")
    return {str(k): np.asarray(v) for k, v in state.items()}


def _sigmoid(x: np.ndarray) -> np.ndarray:
    return 0.5 * (1.0 + np.tanh(0.5 * x))   # overflow-free form of 1 / (1 + exp(-x))


def _relu(x: np.ndarray) -> np.ndarray:
    return np.maximum(x, 0.0, out=x)


def _conv2d(x: np.ndarray, w: np.ndarray, stride_h: int = 1, pad: int = 1) -> np.ndarray:
    """x (C, H, W), w (O, C, kh, kw); stride on H only, as every FCM conv uses."""
    _o, _c, kh, kw = w.shape
    xp = np.pad(x, ((0, 0), (pad, pad), (pad, pad))) if pad else x
    h_out = (xp.shape[1] - kh) // stride_h + 1
    w_out = xp.shape[2] - kw + 1
    out = np.zeros((w.shape[0], h_out, w_out), dtype=np.float32)
    for i in range(kh):
        for j in range(kw):
            patch = xp[:, i: i + stride_h * (h_out - 1) + 1: stride_h, j: j + w_out]
            out += np.tensordot(w[:, :, i, j], patch, axes=(1, 0))
    return out


def _conv1d(x: np.ndarray, w: np.ndarray, stride: int = 1, pad: int = 0, dilation: int = 1,
            bias: np.ndarray | None = None) -> np.ndarray:
    """x (C, T), w (O, C, k)."""
    k = w.shape[2]
    if k == 1 and stride == 1:
        out = w[:, :, 0] @ x
    else:
        xp = np.pad(x, ((0, 0), (pad, pad))) if pad else x
        t_out = (xp.shape[1] - dilation * (k - 1) - 1) // stride + 1
        out = np.zeros((w.shape[0], t_out), dtype=np.float32)
        for i in range(k):
            s = i * dilation
            out += w[:, :, i] @ xp[:, s: s + stride * (t_out - 1) + 1: stride]
    if bias is not None:
        out += bias[:, None]
    return out


class CAMPPlus:
    """fbank (T, 80) -> L2-unnormalised 192-d embedding, as the ONNX graph returns it."""

    def __init__(self, state: dict[str, np.ndarray]):
        self.w = {k: v.astype(np.float32) for k, v in state.items()
                  if not k.endswith("num_batches_tracked")}
        missing = [k for k in ("head.conv1.weight", "xvector.dense.linear.weight") if k not in self.w]
        if missing:
            raise ValueError(f"not a CAM++ state dict (missing {missing})")
        dim = self.w["xvector.dense.linear.weight"].shape[0]
        if dim != EMBEDDING_DIM:
            raise ValueError(f"CAM++ dense layer gives {dim}-d embeddings, expected {EMBEDDING_DIM}")
        # Eval-mode BatchNorm is a fixed per-channel affine map; fold it once.
        self.bn = {}
        for key in self.w:
            if key.endswith(".running_mean"):
                prefix = key[: -len(".running_mean")]
                scale = 1.0 / np.sqrt(self.w[prefix + ".running_var"] + BN_EPS)
                if prefix + ".weight" in self.w:
                    scale = scale * self.w[prefix + ".weight"]
                    shift = self.w[prefix + ".bias"] - self.w[key] * scale
                else:  # 'batchnorm_' (affine=False) on the embedding
                    shift = -self.w[key] * scale
                self.bn[prefix] = (scale.astype(np.float32), shift.astype(np.float32))

    @classmethod
    def from_checkpoint(cls, path: str | Path) -> "CAMPPlus":
        return cls(load_state_dict(path))

    def _norm(self, x: np.ndarray, prefix: str) -> np.ndarray:
        scale, shift = self.bn[prefix]
        shape = (-1,) + (1,) * (x.ndim - 1)
        return x * scale.reshape(shape) + shift.reshape(shape)

    def _res_block(self, x: np.ndarray, p: str, stride: int) -> np.ndarray:
        out = _relu(self._norm(_conv2d(x, self.w[p + ".conv1.weight"], stride, 1), p + ".bn1"))
        out = self._norm(_conv2d(out, self.w[p + ".conv2.weight"], 1, 1), p + ".bn2")
        if p + ".shortcut.0.weight" in self.w:
            x = self._norm(_conv2d(x, self.w[p + ".shortcut.0.weight"], stride, 0), p + ".shortcut.1")
        return _relu(out + x)

    def _head(self, fbank: np.ndarray) -> np.ndarray:
        x = fbank.T[None].astype(np.float32)                       # (1, 80, T)
        x = _relu(self._norm(_conv2d(x, self.w["head.conv1.weight"], 1, 1), "head.bn1"))
        for layer in ("layer1", "layer2"):
            x = self._res_block(x, f"head.{layer}.0", 2)
            x = self._res_block(x, f"head.{layer}.1", 1)
        x = _relu(self._norm(_conv2d(x, self.w["head.conv2.weight"], 2, 1), "head.bn2"))
        return x.reshape(x.shape[0] * x.shape[1], x.shape[2])       # (320, T)

    def _cam_layer(self, h: np.ndarray, p: str, dilation: int) -> np.ndarray:
        y = _conv1d(h, self.w[p + ".linear_local.weight"], pad=dilation, dilation=dilation)
        # context = mean over T + the mean of the 100-frame segment the frame falls in. Both
        # are constant within a segment, so the two 1x1 convs run once per segment.
        t = h.shape[1]
        starts = np.arange(0, t, SEG_LEN)
        seg = np.add.reduceat(h, starts, axis=1) / np.minimum(SEG_LEN, t - starts)[None, :]
        ctx = h.mean(axis=1, keepdims=True) + seg
        ctx = _relu(_conv1d(ctx, self.w[p + ".linear1.weight"], bias=self.w[p + ".linear1.bias"]))
        m = _sigmoid(_conv1d(ctx, self.w[p + ".linear2.weight"], bias=self.w[p + ".linear2.bias"]))
        return y * np.repeat(m, SEG_LEN, axis=1)[:, :t]

    def __call__(self, fbank: np.ndarray) -> np.ndarray:
        fbank = np.asarray(fbank, dtype=np.float32)
        if fbank.ndim != 2 or fbank.shape[1] != 80:
            raise ValueError(f"CAM++ takes (T, 80) fbank, got {fbank.shape}")
        x = self._head(fbank)
        x = _relu(self._norm(_conv1d(x, self.w["xvector.tdnn.linear.weight"], stride=2, pad=2),
                             "xvector.tdnn.nonlinear.batchnorm"))
        for b, (layers, dilation) in enumerate(BLOCKS, start=1):
            for i in range(1, layers + 1):
                p = f"xvector.block{b}.tdnnd{i}"
                h = _conv1d(_relu(self._norm(x, p + ".nonlinear1.batchnorm")), self.w[p + ".linear1.weight"])
                h = _relu(self._norm(h, p + ".nonlinear2.batchnorm"))
                x = np.concatenate([x, self._cam_layer(h, p + ".cam_layer", dilation)], axis=0)
            p = f"xvector.transit{b}"
            x = _conv1d(_relu(self._norm(x, p + ".nonlinear.batchnorm")), self.w[p + ".linear.weight"])
        x = _relu(self._norm(x, "xvector.out_nonlinear.batchnorm"))
        stats = np.concatenate([x.mean(axis=1), x.std(axis=1, ddof=1)])[:, None]
        emb = self.w["xvector.dense.linear.weight"][:, :, 0] @ stats
        return self._norm(emb, "xvector.dense.nonlinear.batchnorm")[:, 0]
