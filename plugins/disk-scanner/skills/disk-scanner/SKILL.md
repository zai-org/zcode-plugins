---
name: disk-scanner
description: Disk space scanner and analyzer for Windows - shows folder sizes, file type breakdown, and largest files
---

# Disk Scanner Skill

Scans disk drives and directories to show space usage analysis.

## Usage

User says "扫描C盘", "扫描D盘", "磁盘扫描", "看看哪个文件占空间", "disk scan", etc.

## Scripts

### disk_scan.py - General Disk Scanner

```bash
python scripts/disk_scan.py --path "C:\" --top 20 --min-size 100MB
```

Features:
- Walks directory tree and calculates folder sizes
- Sorts by size descending
- Shows file type breakdown (top 15 extensions with bar chart)
- Shows top 20 largest files
- Human-readable sizes (B/KB/MB/GB/TB)
- Skips symlinks and junction points
- Handles permission errors gracefully

### game_scan.py - Game File Scanner

```bash
python scripts/game_scan.py --path "D:\"
```

Features:
- Identifies game directories by keywords
- Classifies games by platform (Steam, Epic, GOG, etc.)
- Shows game file type distribution
- Lists largest game files
