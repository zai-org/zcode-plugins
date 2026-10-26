"""Artifact store: every step of a design produces a versioned, hashed file. Workers are stateless."""
from __future__ import annotations

import hashlib
import json
import shutil
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path

from pydantic import BaseModel, Field


class Artifact(BaseModel):
    artifact_id: str
    project_id: str
    kind: str  # blend | stl | 3mf | glb | png | gerber_zip | kicad_pcb | report | ...
    name: str
    sha256: str
    size: int
    parent_id: str | None = None
    meta: dict = Field(default_factory=dict)
    created_at: str
    rel_path: str


_SCHEMA = """
create table if not exists projects(project_id text primary key, name text, created_at text);
create table if not exists artifacts(
  artifact_id text primary key, project_id text, kind text, name text, sha256 text, size integer,
  parent_id text, meta text, created_at text, rel_path text);
create index if not exists idx_art_project on artifacts(project_id, created_at);
"""


class ArtifactStore:
    def __init__(self, root: Path):
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)
        self._db = self.root / "store.sqlite"
        with self._conn() as c:
            c.executescript(_SCHEMA)

    def _conn(self) -> sqlite3.Connection:
        c = sqlite3.connect(self._db, timeout=30)
        c.row_factory = sqlite3.Row
        return c

    # ---- projects
    def create_project(self, name: str = "untitled") -> str:
        pid = "p_" + uuid.uuid4().hex[:8]
        with self._conn() as c:
            c.execute("insert into projects values (?,?,?)", (pid, name, _now()))
        (self.root / "projects" / pid).mkdir(parents=True, exist_ok=True)
        return pid

    def project_exists(self, project_id: str) -> bool:
        with self._conn() as c:
            return c.execute("select 1 from projects where project_id=?", (project_id,)).fetchone() is not None

    def list_projects(self) -> list[dict]:
        with self._conn() as c:
            return [dict(r) for r in c.execute("select * from projects order by created_at desc")]

    # ---- artifacts
    def put_bytes(self, project_id: str, data: bytes, kind: str, name: str, parent_id: str | None = None, meta: dict | None = None) -> Artifact:
        if not self.project_exists(project_id):
            raise KeyError(f"unknown project {project_id}")
        aid = "a_" + uuid.uuid4().hex[:8]
        safe = Path(name).name
        rel = Path("projects") / project_id / f"{aid}_{safe}"
        dest = self.root / rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(data)
        art = Artifact(
            artifact_id=aid, project_id=project_id, kind=kind, name=safe,
            sha256=hashlib.sha256(data).hexdigest(), size=len(data), parent_id=parent_id,
            meta=meta or {}, created_at=_now(), rel_path=str(rel),
        )
        with self._conn() as c:
            c.execute(
                "insert into artifacts values (?,?,?,?,?,?,?,?,?,?)",
                (aid, project_id, kind, safe, art.sha256, art.size, parent_id, json.dumps(art.meta), art.created_at, art.rel_path),
            )
        return art

    def put_file(self, project_id: str, src: Path, kind: str, name: str | None = None, parent_id: str | None = None, meta: dict | None = None) -> Artifact:
        return self.put_bytes(project_id, Path(src).read_bytes(), kind, name or Path(src).name, parent_id, meta)

    def get(self, artifact_id: str) -> Artifact:
        with self._conn() as c:
            r = c.execute("select * from artifacts where artifact_id=?", (artifact_id,)).fetchone()
        if not r:
            raise KeyError(f"unknown artifact {artifact_id}")
        d = dict(r)
        d["meta"] = json.loads(d["meta"] or "{}")
        return Artifact(**d)

    def require(self, project_id: str, artifact_id: str) -> Artifact:
        """Like get(), but the artifact must belong to the project (an id from another project looks like it doesn't exist)."""
        a = self.get(artifact_id)
        if a.project_id != project_id:
            raise KeyError(f"unknown artifact {artifact_id}")
        return a

    def update_meta(self, artifact_id: str, meta: dict) -> Artifact:
        """Merge keys into an artifact's metadata (file content/hash is unchanged). Written by trusted server code only."""
        art = self.get(artifact_id)
        merged = {**art.meta, **meta}
        with self._conn() as c:
            c.execute("update artifacts set meta=? where artifact_id=?", (json.dumps(merged), artifact_id))
        return self.get(artifact_id)

    def path(self, artifact_id: str) -> Path:
        return self.root / self.get(artifact_id).rel_path

    def list(self, project_id: str, kind: str | None = None) -> list[Artifact]:
        q, args = "select * from artifacts where project_id=?", [project_id]
        if kind:
            q, args = q + " and kind=?", args + [kind]
        with self._conn() as c:
            rows = c.execute(q + " order by created_at, rowid", args).fetchall()
        out = []
        for r in rows:
            d = dict(r)
            d["meta"] = json.loads(d["meta"] or "{}")
            out.append(Artifact(**d))
        return out

    def lineage(self, artifact_id: str) -> list[Artifact]:
        chain, cur = [], artifact_id
        while cur:
            a = self.get(cur)
            chain.append(a)
            cur = a.parent_id
        return chain

    def scratch_dir(self, project_id: str, label: str) -> Path:
        d = self.root / "scratch" / project_id / f"{label}_{uuid.uuid4().hex[:6]}"
        d.mkdir(parents=True, exist_ok=True)
        return d

    def cleanup_scratch(self, d: Path) -> None:
        shutil.rmtree(d, ignore_errors=True)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")
