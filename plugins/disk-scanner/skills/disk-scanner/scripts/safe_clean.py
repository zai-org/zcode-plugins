#!/usr/bin/env python3
"""Safe cleanup script for Windows. Only deletes SAFE tier locations."""

import os
import shutil
import sys
from datetime import datetime, timedelta

SAFE_LOCATIONS = [
    (os.environ.get('TEMP', ''), "User temp files"),
    (os.environ.get('LOCALAPPDATA', '') + '\\Temp', "Local temp files"),
    ('C:\\Windows\\Temp', "Windows temp"),
    ('C:\\Windows\\SoftwareDistribution\\Download', "Windows Update downloads"),
    (os.environ.get('LOCALAPPDATA', '') + '\\Microsoft\\Windows\\Explorer\\thumbcache_*.db', "Thumbnail cache"),
    (os.environ.get('LOCALAPPDATA', '') + '\\D3DSCache', "D3D shader cache"),
    (os.environ.get('LOCALAPPDATA', '') + '\\NVIDIA\\DXCache', "NVIDIA DX cache"),
    (os.environ.get('LOCALAPPDATA', '') + '\\NVIDIA\\GLCache', "NVIDIA GL cache"),
    (os.environ.get('LOCALAPPDATA', '') + '\\Microsoft\\Windows\\WebCache', "Web cache"),
    (os.environ.get('LOCALAPPDATA', '') + '\\Microsoft\\Windows\\INetCache', "IE cache"),
    (os.environ.get('LOCALAPPDATA', '') + '\\CrashDumps', "Crash dumps"),
    (os.environ.get('APPDATA', '') + '\\npm-cache', "npm cache"),
    (os.environ.get('LOCALAPPDATA', '') + '\\pip\\cache', "pip cache"),
    (os.environ.get('LOCALAPPDATA', '') + '\\IconCache.db', "Icon cache"),
    (os.environ.get('LOCALAPPDATA', '') + '\\Microsoft\\Windows\\Explorer', "Explorer thumbnails"),
]

def human(n):
    for unit in ['B', 'KB', 'MB', 'GB', 'TB']:
        if abs(n) < 1024:
            return f"{n:.1f} {unit}"
        n /= 1024
    return f"{n:.1f} PB"

def get_size(path):
    total = 0
    try:
        if os.path.isfile(path):
            return os.path.getsize(path)
        for root, dirs, files in os.walk(path, followlinks=False):
            dirs[:] = [d for d in dirs if not os.path.islink(os.path.join(root, d))]
            for f in files:
                try:
                    fp = os.path.join(root, f)
                    if not os.path.islink(fp):
                        total += os.path.getsize(fp)
                except:
                    pass
    except:
        pass
    return total

def clean_path(path, desc):
    """Clean a file or directory. Returns bytes freed."""
    if not path or not os.path.exists(path):
        return 0
    
    size = get_size(path)
    if size == 0:
        return 0
    
    try:
        if os.path.isfile(path):
            os.remove(path)
            print(f"  Deleted: {desc} ({human(size)})")
            return size
        else:
            # Remove contents but keep the directory
            for item in os.listdir(path):
                item_path = os.path.join(path, item)
                try:
                    if os.path.islink(item_path):
                        continue
                    if os.path.isfile(item_path):
                        os.remove(item_path)
                    elif os.path.isdir(item_path):
                        shutil.rmtree(item_path, ignore_errors=True)
                except Exception as e:
                    pass
            print(f"  Cleaned: {desc} ({human(size)})")
            return size
    except Exception as e:
        print(f"  ERROR: {desc} - {e}")
        return 0

def main():
    print("=== Windows Safe Cleanup ===")
    print(f"Started: {datetime.now().strftime('%H:%M:%S')}")
    print()
    
    total_freed = 0
    errors = 0
    
    for path, desc in SAFE_LOCATIONS:
        if '*' in path:
            # Handle glob patterns
            import glob
            matches = glob.glob(path)
            for match in matches:
                total_freed += clean_path(match, desc)
        else:
            total_freed += clean_path(path, desc)
    
    print()
    print(f"=== Done ===")
    print(f"Total freed: {human(total_freed)}")
    print(f"Finished: {datetime.now().strftime('%H:%M:%S')}")
    
    return total_freed

if __name__ == '__main__':
    main()
