"""Our own grid router for small 2-layer boards (no external autorouter).

Model
-----
* Copper shapes (pads, tracks, vias, mounting holes) are exact rounded boxes / capsules. For each net being routed we
  rasterise "where may the CENTRE of a track of this width go?" by testing the exact distance from every grid node to
  every foreign shape (``dist < clearance + half_width + margin``); ``margin = 0.71 * grid`` makes a path through free
  nodes provably clear of foreign copper even on diagonal steps.
* A* on (layer, x, y) with 8 directions, via transitions, small turn penalty, layer-direction preference.
  Multi-pin nets grow a tree (Prim order); every new pad is connected to ANY cell of the tree already routed.
* Nets are routed power-first (wide) then shortest-first. Failed nets trigger rip-up of the nets that block them
  (found with a relaxed search) and, if still failing, a re-ordered restart (a few passes). Fully deterministic.
* Ground (``pour_net``) is not routed with tracks: each SMD pad gets a short stub + via to the other layer and a copper
  pour (done by the builder) does the rest. Through-hole ground pads connect to the pour directly.
* Nothing is dropped silently: ``RouteResult.unrouted`` lists every connection that could not be made, with a reason.
"""
from __future__ import annotations

import heapq
import math
import time
from dataclasses import dataclass, field

import numpy as np

INF = float("inf")
SQRT2 = math.sqrt(2)


# ----------------------------------------------------------------------------------------------- data
@dataclass
class RouteRules:
    grid_mm: float = 0.1
    clearance_mm: float = 0.2
    edge_clearance_mm: float = 0.3
    hole_clearance_mm: float = 0.25
    signal_width_mm: float = 0.25
    power_width_mm: float = 0.5
    via_diameter_mm: float = 0.6
    via_drill_mm: float = 0.3
    via_cost_mm: float = 4.0  # path-length equivalent of a layer change
    turn_cost_cells: float = 0.3
    wrong_way_factor: float = 1.25
    time_budget_s: float = 90.0
    max_passes: int = 4
    rip_budget: int = 6


@dataclass
class RouteNet:
    name: str
    width_mm: float
    kind: str = "signal"  # signal | power | ground


@dataclass
class RouteResult:
    tracks: list[dict] = field(default_factory=list)
    vias: list[dict] = field(default_factory=list)
    unrouted: list[dict] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    stats: dict = field(default_factory=dict)

    @property
    def complete(self) -> bool:
        return not self.unrouted

    def to_dict(self) -> dict:
        return {"tracks": self.tracks, "vias": self.vias, "unrouted": self.unrouted, "warnings": self.warnings, "stats": self.stats}


class Shape:
    """Copper (or hole) shape. kind 'box': rounded box (pads, vias, holes); 'seg': capsule (tracks)."""

    __slots__ = ("kind", "cx", "cy", "hw", "hh", "r", "x2", "y2", "layers", "net", "clr", "is_track", "is_via", "is_pad")

    def __init__(self, kind, cx, cy, hw=0.0, hh=0.0, r=0.0, x2=0.0, y2=0.0, layers=(0,), net=-1, clr=0.0,
                 is_track=False, is_via=False, is_pad=False):
        self.kind, self.cx, self.cy, self.hw, self.hh, self.r, self.x2, self.y2 = kind, cx, cy, hw, hh, r, x2, y2
        self.layers, self.net, self.clr = layers, net, clr
        self.is_track, self.is_via, self.is_pad = is_track, is_via, is_pad

    def bbox(self):
        if self.kind == "seg":
            return (min(self.cx, self.x2) - self.hw, min(self.cy, self.y2) - self.hw,
                    max(self.cx, self.x2) + self.hw, max(self.cy, self.y2) + self.hw)
        return (self.cx - self.hw, self.cy - self.hh, self.cx + self.hw, self.cy + self.hh)

    def dist(self, X, Y):
        """Signed distance from points to the copper boundary (negative inside). X, Y broadcastable arrays."""
        if self.kind == "box":
            qx = np.abs(X - self.cx) - (self.hw - self.r)
            qy = np.abs(Y - self.cy) - (self.hh - self.r)
            return np.hypot(np.maximum(qx, 0), np.maximum(qy, 0)) + np.minimum(np.maximum(qx, qy), 0) - self.r
        dx, dy = self.x2 - self.cx, self.y2 - self.cy
        L2 = dx * dx + dy * dy
        if L2 < 1e-12:
            return np.hypot(X - self.cx, Y - self.cy) - self.hw
        t = np.clip(((X - self.cx) * dx + (Y - self.cy) * dy) / L2, 0.0, 1.0)
        return np.hypot(X - (self.cx + t * dx), Y - (self.cy + t * dy)) - self.hw


def _octile(dx: float, dy: float) -> float:
    dx, dy = abs(dx), abs(dy)
    return (dx + dy) + (SQRT2 - 2) * min(dx, dy)


def _bytes(m: np.ndarray) -> bytearray:
    return bytearray(m.astype(np.uint8).tobytes())


# ----------------------------------------------------------------------------------------------- router
class Router:
    def __init__(self, layout: dict, nets: list[RouteNet], rules: RouteRules, pour_net: str | None = None):
        self.rules = rules
        self.g = rules.grid_mm
        b = layout["board"]
        self.W, self.H, self.corner = float(b["width"]), float(b["height"]), float(b.get("corner_radius", 0.0))
        self.nx = int(round(self.W / self.g)) + 1
        self.ny = int(round(self.H / self.g)) + 1
        self.N = self.nx * self.ny
        self.xs = np.arange(self.nx) * self.g
        self.ys = np.arange(self.ny) * self.g
        self.margin = 0.71 * self.g + 0.005

        self.nets = {n.name: n for n in nets}
        self.net_id = {n.name: i for i, n in enumerate(nets)}
        self.net_names = [n.name for n in nets]
        self.pour_net = pour_net if pour_net in self.net_id else None
        self.width_used: dict[int, float] = {}
        self.warnings: list[str] = []

        self.static: list[Shape] = []
        self.pads_by_net: dict[int, list[dict]] = {}
        for p in layout["pads"]:
            nid = self.net_id.get(p["net"]) if p.get("net") else None
            layers = tuple(0 if ln == "F.Cu" else 1 for ln in p["layers"])
            if not layers:
                continue
            sh = Shape("box", p["x"], p["y"], p["hw"], p["hh"], p["r"], layers=layers, net=nid if nid is not None else -2,
                       clr=rules.clearance_mm, is_pad=True)
            p = dict(p, shape=sh, nid=nid)
            self.static.append(sh)
            if nid is not None:
                self.pads_by_net.setdefault(nid, []).append(p)
        for h in layout.get("holes", []):
            r = h["d"] / 2
            self.static.append(Shape("box", h["x"], h["y"], r, r, r, layers=(0, 1), net=-1, clr=rules.hole_clearance_mm))

        for k in layout.get("keepouts", []):  # no-copper rectangles: hard obstacles for every net on the affected layers
            ly = (0, 1) if k["layers"] == "both" else ((0,) if k["layers"] == "top" else (1,))
            self.static.append(Shape("box", k["x_mm"] + k["width_mm"] / 2, k["y_mm"] + k["height_mm"] / 2, k["width_mm"] / 2, k["height_mm"] / 2, 0.0, layers=ly, net=-1, clr=0.0))

        n = len(nets)
        self.dyn: dict[int, list[Shape]] = {i: [] for i in range(n)}  # routed copper per net
        self.edges: dict[int, set] = {i: set() for i in range(n)}  # graph edges ((l,x,y),(l,x,y)) in um
        self.via_pts: dict[int, set] = {i: set() for i in range(n)}
        self.tree_cells: dict[int, set[int]] = {i: set() for i in range(n)}
        self._mask_cache: dict = {}
        self._edge_cache: dict = {}
        self._ver = 0
        self.stats = {"expansions": 0, "searches": 0}
        self.t_end = time.time() + rules.time_budget_s
        self._pad_cells_cache: dict[int, dict[int, float]] = {}

    # ------------------------------------------------------------------ geometry -> masks
    def _all_shapes(self):
        yield from self.static
        for lst in self.dyn.values():
            yield from lst

    def _mark(self, mask: np.ndarray, s: Shape, R: float):
        x0, y0, x1, y1 = s.bbox()
        i0 = max(0, int(math.floor((x0 - R) / self.g)))
        i1 = min(self.nx - 1, int(math.ceil((x1 + R) / self.g)))
        j0 = max(0, int(math.floor((y0 - R) / self.g)))
        j1 = min(self.ny - 1, int(math.ceil((y1 + R) / self.g)))
        if i1 < i0 or j1 < j0:
            return
        X = self.xs[i0 : i1 + 1][None, :]
        Y = self.ys[j0 : j1 + 1][:, None]
        mask[j0 : j1 + 1, i0 : i1 + 1] |= s.dist(X, Y) < R

    def _edge_mask(self, inset: float) -> np.ndarray:
        key = round(inset, 4)
        m = self._edge_cache.get(key)
        if m is not None:
            return m
        X, Y = self.xs[None, :], self.ys[:, None]
        hx, hy, r = self.W / 2, self.H / 2, self.corner
        qx = np.abs(X - hx) - (hx - r)
        qy = np.abs(Y - hy) - (hy - r)
        sdf = np.hypot(np.maximum(qx, 0), np.maximum(qy, 0)) + np.minimum(np.maximum(qx, qy), 0) - r
        m = (-sdf) < inset
        self._edge_cache[key] = m
        return m

    def _masks(self, nid: int, hw: float, include_tracks: bool = True):
        """Blocked-node masks (per layer) for a track of half width ``hw`` belonging to net ``nid``."""
        key = (nid, round(hw, 4), include_tracks, self._ver)
        c = self._mask_cache.get(key)
        if c is not None:
            return c
        m = [np.zeros((self.ny, self.nx), bool), np.zeros((self.ny, self.nx), bool)]
        for s in self._all_shapes():
            if s.net == nid:
                continue
            if not include_tracks and (s.is_track or s.is_via):
                continue
            R = max(self.rules.clearance_mm, s.clr) + hw + self.margin
            for ly in s.layers:
                self._mark(m[ly], s, R)
        em = self._edge_mask(self.rules.edge_clearance_mm + hw + self.margin)
        m[0] |= em
        m[1] |= em
        if len(self._mask_cache) > 48:
            self._mask_cache.clear()
        self._mask_cache[key] = m
        return m

    def _via_mask(self, nid: int, include_tracks: bool = True) -> np.ndarray:
        """Nodes where a via of this net may NOT be placed."""
        key = ("via", nid, include_tracks, self._ver)
        c = self._mask_cache.get(key)
        if c is not None:
            return c
        vr = self.rules.via_diameter_mm / 2
        m = np.zeros((self.ny, self.nx), bool)
        for s in self._all_shapes():
            if not include_tracks and (s.is_track or s.is_via):
                continue
            if s.net == nid:
                if s.is_pad:
                    R = vr + 0.15 + self.margin  # no via-in-pad
                elif s.is_via:
                    R = vr + 0.1 + self.margin  # hole-to-hole spacing between same-net vias
                else:
                    continue
            else:
                R = max(self.rules.clearance_mm, s.clr) + vr + self.margin
            self._mark(m, s, R)
        m |= self._edge_mask(self.rules.edge_clearance_mm + vr + self.margin)
        self._mask_cache[key] = m
        return m

    # ------------------------------------------------------------------ search
    def _cell(self, x: float, y: float) -> tuple[int, int]:
        return int(round(x / self.g)), int(round(y / self.g))

    def _pad_cells(self, pad: dict) -> dict[int, float]:
        """Flat node indices (layer*N + j*nx + i) inside the pad copper (+ the node nearest its centre) -> cost from centre."""
        cached = self._pad_cells_cache.get(id(pad))
        if cached is not None:
            return cached
        sh: Shape = pad["shape"]
        out: dict[int, float] = {}
        ci, cj = self._cell(sh.cx, sh.cy)
        i0, i1 = max(0, int(math.floor((sh.cx - sh.hw) / self.g))), min(self.nx - 1, int(math.ceil((sh.cx + sh.hw) / self.g)))
        j0, j1 = max(0, int(math.floor((sh.cy - sh.hh) / self.g))), min(self.ny - 1, int(math.ceil((sh.cy + sh.hh) / self.g)))
        X = self.xs[i0 : i1 + 1][None, :]
        Y = self.ys[j0 : j1 + 1][:, None]
        inside = sh.dist(X, Y) <= 0.0
        cells = [(j0 + int(jj), i0 + int(ii)) for jj, ii in zip(*np.nonzero(inside))] + [(cj, ci)]
        for (j, i) in cells:
            c0 = _octile(i - ci, j - cj)
            for ly in sh.layers:
                idx = ly * self.N + j * self.nx + i
                if idx not in out or c0 < out[idx]:
                    out[idx] = c0
        self._pad_cells_cache[id(pad)] = out
        return out

    def _search(self, sources: dict[int, float], goal, goal_bbox, blk, viaok, soft=None, soft_cost: float = 0.0,
                goal_fn=None, max_exp: int = 600000):
        """A* from ``sources`` (idx -> initial cost) to any node with goal[idx] (or goal_fn(layer, c)).
        ``viaok[c] == 0`` means a layer change is allowed at column c. Returns flat indices (source..goal) or None."""
        N, nx = self.N, self.nx
        rules = self.rules
        via_cost = rules.via_cost_mm / self.g
        tp = rules.turn_cost_cells
        wr = rules.wrong_way_factor
        gcost = [INF] * (2 * N)
        par = [-1] * (2 * N)
        heap: list = []
        gx0, gy0, gx1, gy1 = goal_bbox if goal_bbox else (0, 0, 0, 0)
        use_h = goal_fn is None

        def h(c: int) -> float:
            if not use_h:
                return 0.0
            y, x = divmod(c, nx)
            dx = gx0 - x if x < gx0 else (x - gx1 if x > gx1 else 0)
            dy = gy0 - y if y < gy0 else (y - gy1 if y > gy1 else 0)
            return (dx + dy) + (SQRT2 - 2) * (dx if dx < dy else dy)

        cnt = 0
        for idx, c0 in sources.items():
            ly, c = (1, idx - N) if idx >= N else (0, idx)
            if blk[ly][c]:
                continue
            gcost[idx] = c0
            heapq.heappush(heap, (c0 + h(c), cnt, idx, c0))
            cnt += 1
        moves = ((1, 1.0, 0), (-1, 1.0, 0), (nx, 1.0, 1), (-nx, 1.0, 1),
                 (nx + 1, SQRT2, 2), (nx - 1, SQRT2, 2), (-nx + 1, SQRT2, 2), (-nx - 1, SQRT2, 2))
        exp = 0
        pop, push = heapq.heappop, heapq.heappush
        found = None
        while heap:
            _f, _, cur, gc = pop(heap)
            if gc > gcost[cur]:
                continue
            ly, c = (1, cur - N) if cur >= N else (0, cur)
            if goal_fn is not None:
                if goal_fn(ly, c):
                    found = cur
                    break
            elif goal[cur]:
                found = cur
                break
            exp += 1
            if exp > max_exp or ((exp & 4095) == 0 and time.time() > self.t_end):
                break
            B = blk[ly]
            S = soft[ly] if soft is not None else None
            p = par[cur]
            pd = None
            if p >= 0 and (p >= N) == (cur >= N):
                pd = c - (p - N if p >= N else p)
            base = ly * N
            for off, step, kind in moves:
                nc = c + off
                if B[nc]:
                    continue
                cost = step
                if kind == 0:
                    if ly == 1:
                        cost = step * wr
                elif kind == 1:
                    if ly == 0:
                        cost = step * wr
                if pd is not None and off != pd:
                    cost += tp
                if S is not None and S[nc]:
                    cost += soft_cost
                ni = base + nc
                ng = gc + cost
                if ng < gcost[ni]:
                    gcost[ni] = ng
                    par[ni] = cur
                    push(heap, (ng + h(nc), cnt, ni, ng))
                    cnt += 1
            if viaok[c] == 0:
                ol = 1 - ly
                if not blk[ol][c]:
                    ni = ol * N + c
                    ng = gc + via_cost
                    if ng < gcost[ni]:
                        gcost[ni] = ng
                        par[ni] = cur
                        push(heap, (ng + h(c), cnt, ni, ng))
                        cnt += 1
        self.stats["expansions"] += exp
        self.stats["searches"] += 1
        if found is None:
            return None
        out = [found]
        while par[found] != -1:
            found = par[found]
            out.append(found)
        out.reverse()
        return out

    # ------------------------------------------------------------------ helpers
    def _xy(self, idx: int) -> tuple[int, float, float]:
        ly, c = (1, idx - self.N) if idx >= self.N else (0, idx)
        j, i = divmod(c, self.nx)
        return ly, round(i * self.g, 6), round(j * self.g, 6)

    @staticmethod
    def _key(ly: int, x: float, y: float):
        return (ly, int(round(x * 1000)), int(round(y * 1000)))

    def _net_width(self, nid: int) -> float:
        return self.width_used.get(nid, self.nets[self.net_names[nid]].width_mm)

    def _add_edge(self, nid: int, a, b):
        self.edges[nid].add((a, b) if a <= b else (b, a))

    def _record_path(self, nid: int, path: list[int], width: float, start_pad, end_pad):
        """Store a found path: shapes (for later obstacle masks), graph edges (for output), tree cells (for later joins)."""
        pts = [self._xy(i) for i in path]
        clr = self.rules.clearance_mm
        vr = self.rules.via_diameter_mm / 2

        def stub(pad, pt):
            if pad is None:
                return
            sh: Shape = pad["shape"]
            ly, x, y = pt
            if ly in sh.layers and math.hypot(sh.cx - x, sh.cy - y) > 1e-4:
                self._add_edge(nid, self._key(ly, sh.cx, sh.cy), self._key(ly, x, y))
                self.dyn[nid].append(Shape("seg", sh.cx, sh.cy, hw=width / 2, x2=x, y2=y, layers=(ly,), net=nid, clr=clr, is_track=True))

        stub(start_pad, pts[0])
        stub(end_pad, pts[-1])
        for k in range(1, len(pts)):
            a, b = pts[k - 1], pts[k]
            if a[0] != b[0]:  # layer change = via
                self.via_pts[nid].add((int(round(a[1] * 1000)), int(round(a[2] * 1000))))
                self.dyn[nid].append(Shape("box", a[1], a[2], vr, vr, vr, layers=(0, 1), net=nid, clr=clr, is_via=True))
            else:
                self._add_edge(nid, self._key(*a), self._key(*b))
        k = 0
        while k < len(pts) - 1:  # one capsule per straight run
            if pts[k][0] != pts[k + 1][0]:
                k += 1
                continue
            d0 = (pts[k + 1][1] - pts[k][1], pts[k + 1][2] - pts[k][2])
            j = k + 1
            while (j + 1 < len(pts) and pts[j + 1][0] == pts[k][0]
                   and abs((pts[j + 1][1] - pts[j][1]) - d0[0]) < 1e-9 and abs((pts[j + 1][2] - pts[j][2]) - d0[1]) < 1e-9):
                j += 1
            self.dyn[nid].append(Shape("seg", pts[k][1], pts[k][2], hw=width / 2, x2=pts[j][1], y2=pts[j][2], layers=(pts[k][0],),
                                       net=nid, clr=clr, is_track=True))
            k = j
        self.tree_cells[nid].update(path)
        self._ver += 1

    def _groups(self, nid: int) -> list[list[dict]]:
        """Pads of a net grouped by physical contact (overlapping same-net pads are already one conductor)."""
        pads = self.pads_by_net.get(nid, [])
        parent = list(range(len(pads)))

        def find(a):
            while parent[a] != a:
                parent[a] = parent[parent[a]]
                a = parent[a]
            return a

        for a in range(len(pads)):
            for b in range(a + 1, len(pads)):
                sa, sb = pads[a]["shape"], pads[b]["shape"]
                if not set(sa.layers) & set(sb.layers):
                    continue
                if float(sa.dist(np.array(sb.cx), np.array(sb.cy))) <= 0 or float(sb.dist(np.array(sa.cx), np.array(sa.cy))) <= 0:
                    parent[find(a)] = find(b)
        groups: dict[int, list[dict]] = {}
        for k, p in enumerate(pads):
            groups.setdefault(find(k), []).append(p)
        return sorted(groups.values(), key=lambda g: (g[0]["ref"], g[0]["number"], g[0]["x"], g[0]["y"]))

    @staticmethod
    def _centre(g: list[dict]):
        return (sum(p["x"] for p in g) / len(g), sum(p["y"] for p in g) / len(g))

    # ------------------------------------------------------------------ net routing
    def route_net(self, nid: int, relaxed: bool = False):
        """Route one net. Returns (ok, failures, victims). In relaxed mode, connections that cannot be made are searched
        again ignoring other nets' tracks (not recorded) and the nets in the way are returned as victims."""
        width = self._net_width(nid)
        groups = self._groups(nid)
        failures: list[dict] = []
        victims: set[int] = set()
        if len(groups) < 2:
            return True, failures, victims
        hw = width / 2
        strict = self._masks(nid, hw, include_tracks=True)
        blk = [_bytes(strict[0]), _bytes(strict[1])]
        viaok = _bytes(self._via_mask(nid, include_tracks=True))
        if relaxed:
            hard = self._masks(nid, hw, include_tracks=False)
            blk_h = [_bytes(hard[0]), _bytes(hard[1])]
            soft = [_bytes(strict[k] & ~hard[k]) for k in (0, 1)]
            viaok_h = _bytes(self._via_mask(nid, include_tracks=False))

        cents = [self._centre(g) for g in groups]
        order = sorted(range(len(groups)), key=lambda k: (cents[k][0], cents[k][1]))
        tree_groups = [order[0]]
        rest = order[1:]
        tree: set[int] = set(self.tree_cells[nid])
        cell_pad: dict[int, dict] = {}
        for p in groups[order[0]]:
            for idx in self._pad_cells(p):
                tree.add(idx)
                cell_pad[idx] = p
        ok_all = True
        while rest:
            tcs = [cents[k] for k in tree_groups]
            best = min(rest, key=lambda k: (min(math.hypot(cents[k][0] - c[0], cents[k][1] - c[1]) for c in tcs),
                                            groups[k][0]["ref"], groups[k][0]["number"]))
            rest.remove(best)
            sources: dict[int, float] = {}
            src_pad: dict[int, dict] = {}
            for p in groups[best]:
                for idx, c0 in self._pad_cells(p).items():
                    if idx not in sources or c0 < sources[idx]:
                        sources[idx] = c0
                        src_pad[idx] = p
            goal = bytearray(2 * self.N)
            gxs, gys = [], []
            for idx in tree:
                goal[idx] = 1
                c = idx - self.N if idx >= self.N else idx
                j, i = divmod(c, self.nx)
                gxs.append(i)
                gys.append(j)
            bbox = (min(gxs), min(gys), max(gxs), max(gys))
            path = self._search(sources, goal, bbox, blk, viaok)
            if path is None:
                a = groups[best][0]
                if relaxed:
                    p2 = self._search(sources, goal, bbox, blk_h, viaok_h, soft=soft, soft_cost=25.0)
                    if p2 is not None:
                        victims |= self._victims(nid, p2, hw)
                        reason = "blocked by tracks of other nets"
                    else:
                        reason = "pad enclosed by other pads / board edge"
                else:
                    reason = "no free path (blocked by other copper or the board edge)"
                failures.append({"net": self.net_names[nid], "from": f"{a['ref']}.{a['number']}", "to": "net", "reason": reason})
                ok_all = False
                continue
            self._record_path(nid, path, width, src_pad.get(path[0]), cell_pad.get(path[-1]))
            tree.update(path)
            for p in groups[best]:
                for idx in self._pad_cells(p):
                    tree.add(idx)
                    cell_pad[idx] = p
            tree_groups.append(best)
        return ok_all, failures, victims

    def _victims(self, nid: int, path: list[int], hw: float) -> set[int]:
        """Nets whose tracks/vias are within clearance of a (relaxed) path."""
        out: set[int] = set()
        pts = [self._xy(i) for i in path]
        for other, lst in self.dyn.items():
            if other == nid:
                continue
            for s in lst:
                R = max(self.rules.clearance_mm, s.clr) + hw + self.margin
                x0, y0, x1, y1 = s.bbox()
                for ly, x, y in pts:
                    if ly not in s.layers or x < x0 - R or x > x1 + R or y < y0 - R or y > y1 + R:
                        continue
                    if float(s.dist(np.array(x), np.array(y))) < R:
                        out.add(other)
                        break
                if other in out:
                    break
        return out

    def rip_up(self, nid: int):
        self.dyn[nid] = []
        self.edges[nid] = set()
        self.via_pts[nid] = set()
        self.tree_cells[nid] = set()
        self._ver += 1

    # ------------------------------------------------------------------ ground stitching
    def stitch_ground(self, failures: list[dict]):
        if not self.pour_net:
            return
        nid = self.net_id[self.pour_net]
        width = self.rules.signal_width_mm
        hw = width / 2
        no_layer_change = bytearray(b"\x01" * self.N)
        for pad in sorted(self.pads_by_net.get(nid, []), key=lambda p: (p["ref"], p["number"], p["x"], p["y"])):
            sh: Shape = pad["shape"]
            if len(sh.layers) > 1:
                continue  # through-hole: touches the pour on both layers
            ly0 = sh.layers[0]
            other = 1 - ly0
            m = self._masks(nid, hw)
            blk = [_bytes(m[0]), _bytes(m[1])]
            viaok = _bytes(self._via_mask(nid))

            def is_goal(ly, c):
                return ly == ly0 and viaok[c] == 0 and not blk[other][c]

            path = self._search(dict(self._pad_cells(pad)), None, None, blk, no_layer_change, goal_fn=is_goal, max_exp=60000)
            if path is None:
                failures.append({"net": self.pour_net, "from": f"{pad['ref']}.{pad['number']}", "to": "pour",
                                 "reason": "no room for a ground stitching via next to this pad", "kind": "ground_stitch"})
                continue
            end = path[-1]
            c = end - self.N if end >= self.N else end
            via_idx = other * self.N + c
            self._record_path(nid, path + [via_idx], width, pad, None)

    # ------------------------------------------------------------------ driver
    def _order(self) -> list[int]:
        names = [n for n in self.net_names if n != self.pour_net and len(self._groups(self.net_id[n])) >= 2]

        def span(n):
            pads = self.pads_by_net.get(self.net_id[n], [])
            xs = [p["x"] for p in pads]
            ys = [p["y"] for p in pads]
            return (max(xs) - min(xs)) + (max(ys) - min(ys))

        names.sort(key=lambda n: (0 if self.nets[n].kind == "power" else 1, span(n), n))
        return [self.net_id[n] for n in names]

    def _route_with_fallback_width(self, nid: int):
        ok, f, v = self.route_net(nid)
        sig = self.rules.signal_width_mm
        if not ok and self._net_width(nid) > sig + 1e-9 and nid not in self.width_used:
            self.rip_up(nid)
            self.width_used[nid] = sig
            ok, f, v = self.route_net(nid)
            if ok:
                self.warnings.append(
                    f"Net '{self.net_names[nid]}' could not be routed at {self.nets[self.net_names[nid]].width_mm} mm; "
                    f"routed at {sig} mm instead (not enough room)."
                )
            else:
                self.rip_up(nid)
                self.width_used.pop(nid, None)
                ok, f, v = self.route_net(nid)  # restore the wide partial attempt for the report
        return ok, f, v

    def _route_all(self, order: list[int]) -> tuple[list[dict], list[int]]:
        failed: dict[int, list[dict]] = {}
        for nid in order:
            ok, f, _ = self._route_with_fallback_width(nid)
            if not ok:
                failed[nid] = f
        rips = 0
        for nid in list(failed):
            if rips >= self.rules.rip_budget or time.time() > self.t_end:
                break
            snap = self._snapshot()
            before = dict(failed)
            self.rip_up(nid)
            ok, f, victims = self.route_net(nid, relaxed=True)
            victims.discard(nid)
            self.rip_up(nid)
            if not victims:
                continue
            rips += 1
            vlist = sorted(victims)[:3]
            for v in vlist:
                self.rip_up(v)
            ok, f, _ = self.route_net(nid)
            if ok:
                failed.pop(nid, None)
            else:
                failed[nid] = f
            for v in vlist:
                ok2, f2, _ = self._route_with_fallback_width(v)
                if ok2:
                    failed.pop(v, None)
                else:
                    failed[v] = f2
            if len(failed) > len(before):  # made things worse: undo
                self._restore(snap)
                failed = before
        flat: list[dict] = []
        for nid in failed:
            flat.extend(failed[nid])
        return flat, list(failed)

    def route(self) -> RouteResult:
        t0 = time.time()
        self.t_end = t0 + self.rules.time_budget_s
        order = self._order()
        best = None
        passes = 0
        for _ in range(self.rules.max_passes):
            passes += 1
            for nid in list(self.dyn):
                self.rip_up(nid)
            self.width_used = {}
            self.warnings = []
            fail, failed_nids = self._route_all(order)
            score = (len(fail), self._total_length())
            if best is None or score < best[0]:
                best = (score, self._snapshot(), fail, dict(self.width_used), list(self.warnings))
            if not fail or time.time() > self.t_end:
                break
            order = failed_nids + [n for n in order if n not in failed_nids]  # priority boost, then restart
        _, snap, fail, wu, warns = best
        self._restore(snap)
        self.width_used = wu
        self.warnings = warns
        stitch_fail: list[dict] = []
        self.stitch_ground(stitch_fail)
        res = self._emit()
        res.unrouted = fail + stitch_fail
        res.warnings = list(self.warnings)
        res.stats = {
            "passes": passes, "nets_routed": len(order), "vias": len(res.vias), "segments": len(res.tracks),
            "unrouted_connections": len(res.unrouted), "length_mm": round(self._total_length(), 2),
            "seconds": round(time.time() - t0, 2), "grid_mm": self.g, **self.stats,
        }
        return res

    def _total_length(self) -> float:
        return sum(math.hypot(s.x2 - s.cx, s.y2 - s.cy) for lst in self.dyn.values() for s in lst if s.is_track)

    def _snapshot(self):
        return ({k: list(v) for k, v in self.dyn.items()}, {k: set(v) for k, v in self.edges.items()},
                {k: set(v) for k, v in self.via_pts.items()}, {k: set(v) for k, v in self.tree_cells.items()},
                dict(self.width_used), list(self.warnings))

    def _restore(self, snap):
        self.dyn = {k: list(v) for k, v in snap[0].items()}
        self.edges = {k: set(v) for k, v in snap[1].items()}
        self.via_pts = {k: set(v) for k, v in snap[2].items()}
        self.tree_cells = {k: set(v) for k, v in snap[3].items()}
        self.width_used = dict(snap[4])
        self.warnings = list(snap[5])
        self._ver += 1

    # ------------------------------------------------------------------ output
    def _emit(self) -> RouteResult:
        res = RouteResult()
        for nid in range(len(self.net_names)):
            name = self.net_names[nid]
            width = self.rules.signal_width_mm if name == self.pour_net else self._net_width(nid)
            edges = self.edges[nid]
            if not edges:
                continue
            adj: dict[tuple, list] = {}
            for a, b in edges:
                adj.setdefault(a, []).append(b)
                adj.setdefault(b, []).append(a)
            vias = self.via_pts[nid]
            pad_pts = set()
            for p in self.pads_by_net.get(nid, []):
                for ly in p["shape"].layers:
                    pad_pts.add(self._key(ly, p["shape"].cx, p["shape"].cy))

            def keep(n):
                return len(adj[n]) != 2 or (n[1], n[2]) in vias or n in pad_pts

            seen: set = set()
            for start in sorted(adj):
                if not keep(start):
                    continue
                for nb in sorted(adj[start]):
                    e0 = (start, nb) if start <= nb else (nb, start)
                    if e0 in seen:
                        continue
                    seen.add(e0)
                    chain = [start, nb]
                    prev, cur = start, nb
                    while not keep(cur):
                        nxt = [x for x in adj[cur] if x != prev]
                        if not nxt:
                            break
                        n2 = nxt[0]
                        ee = (cur, n2) if cur <= n2 else (n2, cur)
                        if ee in seen:
                            break
                        seen.add(ee)
                        chain.append(n2)
                        prev, cur = cur, n2
                    a = 0
                    for k in range(1, len(chain)):
                        if k == len(chain) - 1 or not _collinear(chain[a], chain[k], chain[k + 1]):
                            p0, p1 = chain[a], chain[k]
                            if p0 != p1:
                                res.tracks.append({"net": name, "layer": "F.Cu" if p0[0] == 0 else "B.Cu",
                                                   "x1": p0[1] / 1000, "y1": p0[2] / 1000, "x2": p1[1] / 1000, "y2": p1[2] / 1000,
                                                   "width": round(width, 4)})
                            a = k
            for (x, y) in sorted(vias):
                res.vias.append({"net": name, "x": x / 1000, "y": y / 1000, "dia": self.rules.via_diameter_mm, "drill": self.rules.via_drill_mm})
        return res


def _collinear(a, b, c) -> bool:
    """b lies on the straight line a->c continuing in the same direction."""
    return (b[1] - a[1]) * (c[2] - b[2]) == (b[2] - a[2]) * (c[1] - b[1]) and (
        (b[1] - a[1]) * (c[1] - b[1]) + (b[2] - a[2]) * (c[2] - b[2]) > 0)


# ----------------------------------------------------------------------------------------------- independent checks (tests)
def _seg_seg_dist(p, q, r, s) -> float:
    """Minimum distance between segments pq and rs (2-D)."""
    def pt_seg(a, b, c):
        dx, dy = c[0] - b[0], c[1] - b[1]
        L2 = dx * dx + dy * dy
        t = 0.0 if L2 < 1e-18 else max(0.0, min(1.0, ((a[0] - b[0]) * dx + (a[1] - b[1]) * dy) / L2))
        return math.hypot(a[0] - (b[0] + t * dx), a[1] - (b[1] + t * dy))

    def ccw(a, b, c):
        return (c[1] - a[1]) * (b[0] - a[0]) - (b[1] - a[1]) * (c[0] - a[0])

    d1, d2, d3, d4 = ccw(p, q, r), ccw(p, q, s), ccw(r, s, p), ccw(r, s, q)
    if d1 * d2 < 0 and d3 * d4 < 0:
        return 0.0
    return min(pt_seg(p, r, s), pt_seg(q, r, s), pt_seg(r, p, q), pt_seg(s, p, q))


def verify_routes(layout: dict, res: RouteResult, rules: RouteRules, tol: float = 0.015) -> list[str]:
    """Independent clearance check of routed copper vs foreign pads / holes / tracks / board edge (used by tests)."""
    problems: list[str] = []
    pad_shapes = []
    for p in layout["pads"]:
        layers = tuple(0 if ln == "F.Cu" else 1 for ln in p["layers"])
        pad_shapes.append((p, Shape("box", p["x"], p["y"], p["hw"], p["hh"], p["r"], layers=layers)))
    holes = [Shape("box", h["x"], h["y"], h["d"] / 2, h["d"] / 2, h["d"] / 2) for h in layout.get("holes", [])]
    caps = []  # (kind, net, layer, p, q, radius)
    for t in res.tracks:
        caps.append(("track", t["net"], 0 if t["layer"] == "F.Cu" else 1, (t["x1"], t["y1"]), (t["x2"], t["y2"]), t["width"] / 2))
    for v in res.vias:
        for ly in (0, 1):
            caps.append(("via", v["net"], ly, (v["x"], v["y"]), (v["x"], v["y"]), v["dia"] / 2))
    W, H, cr = layout["board"]["width"], layout["board"]["height"], layout["board"].get("corner_radius", 0.0)
    for kind, net, ly, p, q, rad in caps:
        L = math.hypot(q[0] - p[0], q[1] - p[1])
        n = max(2, int(L / 0.02) + 1)
        pts = [(p[0] + (q[0] - p[0]) * k / (n - 1), p[1] + (q[1] - p[1]) * k / (n - 1)) for k in range(n)]
        xs, ys = np.array([a for a, _ in pts]), np.array([b for _, b in pts])
        for pd, ps in pad_shapes:
            if pd.get("net") == net or ly not in ps.layers:
                continue
            d = float(np.min(ps.dist(xs, ys))) - rad
            if d < rules.clearance_mm - tol:
                problems.append(f"{kind} of {net} is {d:.3f} mm from pad {pd['ref']}.{pd['number']} (needs {rules.clearance_mm})")
        for hs in holes:
            d = float(np.min(hs.dist(xs, ys))) - rad
            if d < rules.hole_clearance_mm - tol:
                problems.append(f"{kind} of {net} is {d:.3f} mm from a mounting hole")
        for k in layout.get("keepouts", []):  # no copper at all inside a keep-out on the layers it covers
            if (k["layers"] == "both" or (k["layers"] == "top") == (ly == 0)):
                ex = np.maximum(k["x_mm"] - xs, xs - (k["x_mm"] + k["width_mm"]))
                ey = np.maximum(k["y_mm"] - ys, ys - (k["y_mm"] + k["height_mm"]))
                sd = np.hypot(np.maximum(ex, 0), np.maximum(ey, 0)) + np.minimum(np.maximum(ex, ey), 0)  # signed distance to the rectangle
                if float(np.min(sd)) - rad < -tol:
                    problems.append(f"{kind} of {net} near ({p[0]:.2f},{p[1]:.2f}) enters a keep-out zone")
        hx, hy = W / 2, H / 2
        qx, qy = np.abs(xs - hx) - (hx - cr), np.abs(ys - hy) - (hy - cr)
        inside = -(np.hypot(np.maximum(qx, 0), np.maximum(qy, 0)) + np.minimum(np.maximum(qx, qy), 0) - cr)
        if float(np.min(inside)) - rad < rules.edge_clearance_mm - tol:
            problems.append(f"{kind} of {net} near ({p[0]:.2f},{p[1]:.2f}) is {float(np.min(inside)) - rad:.3f} mm from the board edge")
    for i, a in enumerate(caps):
        for b in caps[i + 1:]:
            if a[1] == b[1] or a[2] != b[2]:
                continue
            d = _seg_seg_dist(a[3], a[4], b[3], b[4]) - a[5] - b[5]
            if d < rules.clearance_mm - tol:
                problems.append(f"{a[0]} of {a[1]} is {d:.3f} mm from {b[0]} of {b[1]} (needs {rules.clearance_mm})")
    return sorted(set(problems))


def connectivity_problems(layout: dict, res: RouteResult, skip_net: str | None = None) -> list[str]:
    """Nets whose pads are not all connected by the routed copper (through-hole pads join both layers). For tests."""
    out: list[str] = []
    by_net: dict[str, list[dict]] = {}
    for p in layout["pads"]:
        if p.get("net") and p["net"] != skip_net:
            by_net.setdefault(p["net"], []).append(p)
    for net, pads in by_net.items():
        parent: dict = {}

        def find(a):
            parent.setdefault(a, a)
            while parent[a] != a:
                parent[a] = parent[parent[a]]
                a = parent[a]
            return a

        def union(a, b):
            parent[find(a)] = find(b)

        for t in res.tracks:
            if t["net"] == net:
                union(("pt", t["layer"], round(t["x1"], 3), round(t["y1"], 3)), ("pt", t["layer"], round(t["x2"], 3), round(t["y2"], 3)))
        for v in res.vias:
            if v["net"] == net:
                union(("pt", "F.Cu", round(v["x"], 3), round(v["y"], 3)), ("pt", "B.Cu", round(v["x"], 3), round(v["y"], 3)))
        for i, p in enumerate(pads):
            sh = Shape("box", p["x"], p["y"], p["hw"], p["hh"], p["r"])
            if len(p["layers"]) == 2:
                union(("pad", i, "F.Cu"), ("pad", i, "B.Cu"))
            for t in res.tracks:
                if t["net"] != net or t["layer"] not in p["layers"]:
                    continue
                for x, y in ((t["x1"], t["y1"]), (t["x2"], t["y2"])):
                    if float(sh.dist(np.array(x), np.array(y))) <= 0.001:
                        union(("pad", i, t["layer"]), ("pt", t["layer"], round(x, 3), round(y, 3)))
        roots = {find(("pad", i, p["layers"][0])) for i, p in enumerate(pads)}
        if len(roots) > 1:
            out.append(f"net {net}: pads fall into {len(roots)} disconnected groups")
    return out
