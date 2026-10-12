#!/usr/bin/env python3
"""Disk space scanner - shows folder sizes, file types, and largest files."""

import os
import sys
import argparse
from collections import defaultdict

def human(n):
    """Convert bytes to human-readable format."""
    for unit in ['B', 'KB', 'MB', 'GB', 'TB']:
        if abs(n) < 1024.0:
            return f"{n:.1f} {unit}"
        n /= 1024.0
    return f"{n:.1f} PB"

def scan_path(path, min_size=0):
    """Scan a path and return folder sizes, file types, and large files."""
    folder_sizes = defaultdict(int)
    file_types = defaultdict(lambda: [0, 0])  # [count, total_size]
    large_files = []
    
    for root, dirs, files in os.walk(path, followlinks=False):
        # Skip junctions and symlinks
        dirs[:] = [d for d in dirs if not os.path.islink(os.path.join(root, d))]
        
        for f in files:
            fp = os.path.join(root, f)
            try:
                if os.path.islink(fp):
                    continue
                sz = os.path.getsize(fp)
                
                # Add to all parent folders
                parts = root.replace(path, '').split(os.sep)
                current = path
                folder_sizes[current] += sz
                for part in parts:
                    if part:
                        current = os.path.join(current, part)
                        folder_sizes[current] += sz
                
                # Track file types
                ext = os.path.splitext(f)[1].lower() or '(no ext)'
                file_types[ext][0] += 1
                file_types[ext][1] += sz
                
                # Track large files
                if sz >= min_size:
                    large_files.append((fp, sz))
            except (PermissionError, OSError):
                pass
    
    return dict(folder_sizes), dict(file_types), large_files

def main():
    parser = argparse.ArgumentParser(description='Disk space scanner')
    parser.add_argument('--path', default='C:\\', help='Path to scan')
    parser.add_argument('--top', type=int, default=20, help='Number of top items to show')
    parser.add_argument('--min-size', type=int, default=100*1024*1024, help='Minimum file size in bytes')
    args = parser.parse_args()
    
    path = os.path.normpath(args.path)
    print(f"Scanning {path} ...")
    print()
    
    folder_sizes, file_types, large_files = scan_path(path, args.min_size)
    
    # Top folders
    print(f"=== Top {args.top} Largest Folders ===")
    sorted_folders = sorted(folder_sizes.items(), key=lambda x: x[1], reverse=True)[:args.top]
    for folder, size in sorted_folders:
        print(f"  {human(size):>10}  {folder}")
    
    # Top file types
    print(f"\n=== Top 15 File Types by Size ===")
    sorted_types = sorted(file_types.items(), key=lambda x: x[1][1], reverse=True)[:15]
    max_size = sorted_types[0][1][1] if sorted_types else 1
    for ext, (count, size) in sorted_types:
        bar_len = int(30 * size / max_size)
        bar = '\u2588' * bar_len
        print(f"  {ext:>12} {human(size):>10} ({count:>6} files) {bar}")
    
    # Top large files
    print(f"\n=== Top {args.top} Largest Files ===")
    large_files.sort(key=lambda x: x[1], reverse=True)
    for fp, size in large_files[:args.top]:
        print(f"  {human(size):>10}  {fp}")
    
    # Summary
    total_size = sum(folder_sizes.values())
    print(f"\n=== Summary ===")
    print(f"Total scanned: {human(total_size)}")
    print(f"Folders: {len(folder_sizes)}")
    print(f"File types: {len(file_types)}")

if __name__ == "__main__":
    main()
