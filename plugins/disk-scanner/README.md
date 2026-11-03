# disk-scanner

[中文文档](./README_CN.md)

A local-first Windows disk space analyzer for ZCode. Ask "扫描C盘" or "which folders eat my disk?" and the agent runs read-only scans, then walks you through cleanup decisions with explicit confirmation before anything is deleted.

## What it does

- **Folder size ranking** — walks a directory tree, sorts folders by size, skips symlinks/junctions, handles permission errors gracefully.
- **File-type breakdown** — top extensions by total size with bar charts.
- **Largest files list** — configurable top-N with human-readable sizes (B/KB/MB/GB/TB).
- **Cleanup analysis** (`clean_scan.py`) — identifies cache/tmp/log candidates with safety notes.
- **Safe cleanup** (`safe_clean.py`) — deletes only after an explicit user confirmation step; never touches system paths.

## Structure

```text
disk-scanner/
├── .zcode-plugin/
│   └── plugin.json
└── skills/
    └── disk-scanner/
        ├── SKILL.md
        └── scripts/
            ├── disk_scan.py     # read-only scan: sizes, types, largest files
            ├── clean_scan.py    # find cache/tmp/log cleanup candidates
            ├── game_scan.py     # locate game install dirs and their sizes
            └── safe_clean.py    # delete after explicit confirmation only
```

## Side effects

| Effect | Detail |
| --- | --- |
| File reads | Reads directory metadata and file sizes on the drive you scan. |
| File writes | None while scanning. `safe_clean.py` deletes only user-confirmed paths. |
| Network | None. All analysis is local. |
| Commands | Runs bundled Python scripts (standard library only, no third-party deps). |

## Requirements

- Windows (any recent version)
- Python 3.8+

## Author

wdfdsyhb · [source repository](https://github.com/wdfdsyhb/zcode-plugins-community)
