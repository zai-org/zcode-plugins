#!/usr/bin/env python3
"""Cleanable file scanner for Windows + ZCode."""

import os
import sys
from collections import defaultdict

# Tier definitions: ✅ Safe, ⚠️ Caution, 🔒 Protect
TIER_SAFE = "SAFE"
TIER_CAUTION = "CAUTION"
TIER_PROTECT = "PROTECT"

TIER_ICONS = {
    TIER_SAFE: "✅",
    TIER_CAUTION: "⚠️",
    TIER_PROTECT: "🔒",
}

# Windows cleanup locations
LOCATIONS = [
    (os.environ.get('TEMP', ''), TIER_SAFE, "User temp files"),
    (os.environ.get('LOCALAPPDATA', '') + '\\Temp', TIER_SAFE, "Local temp files"),
    ('C:\\Windows\\Temp', TIER_SAFE, "Windows temp"),
    ('C:\\Windows\\SoftwareDistribution\\Download', TIER_SAFE, "Windows Update downloads"),
    (os.environ.get('LOCALAPPDATA', '') + '\\Microsoft\\Windows\\Explorer', TIER_SAFE, "Thumbnail cache"),
    (os.environ.get('LOCALAPPDATA', '') + '\\D3DSCache', TIER_SAFE, "D3D shader cache"),
    (os.environ.get('LOCALAPPDATA', '') + '\\NVIDIA\\DXCache', TIER_SAFE, "NVIDIA DX cache"),
    (os.environ.get('LOCALAPPDATA', '') + '\\NVIDIA\\GLCache', TIER_SAFE, "NVIDIA GL cache"),
    (os.environ.get('LOCALAPPDATA', '') + '\\Microsoft\\Windows\\WebCache', TIER_SAFE, "Web cache"),
    (os.environ.get('LOCALAPPDATA', '') + '\\Microsoft\\Windows\\INetCache', TIER_SAFE, "IE cache"),
    (os.environ.get('APPDATA', '') + '\\npm-cache', TIER_SAFE, "npm cache"),
    (os.environ.get('LOCALAPPDATA', '') + '\\pip\\cache', TIER_SAFE, "pip cache"),
    (os.environ.get('LOCALAPPDATA', '') + '\\NVIDIA\\DotOptCache', TIER_SAFE, "NVIDIA DotOpt cache"),
    (os.environ.get('LOCALAPPDATA', '') + '\\CrashDumps', TIER_SAFE, "Crash dumps"),
    (os.environ.get('LOCALAPPDATA', '') + '\\Docker', TIER_CAUTION, "Docker data (regenerates)"),
    (os.environ.get('LOCALAPPDATA', '') + '\\wsl', TIER_CAUTION, "WSL data (regenerates)"),
    ('C:\\Windows\\WinSxS', TIER_PROTECT, "Windows component store"),
    ('C:\\Windows\\Installer', TIER_PROTECT, "Installer cache"),
    ('C:\\Windows\\Logs\\CBS', TIER_PROTECT, "CBS logs"),
    ('C:\\Windows\\Logs\\DISM', TIER_PROTECT, "DISM logs"),
]


def human(n):
    for unit in ['B', 'KB', 'MB', 'GB', 'TB']:
        if abs(n) < 1024:
            return f"{n:.1f} {unit}"
        n /= 1024
    return f"{n:.1f} PB"


def get_size(path):
    """Get total size of a directory."""
    total = 0
    try:
        for root, dirs, files in os.walk(path, followlinks=False):
            dirs[:] = [d for d in dirs if not os.path.islink(os.path.join(root, d))]
            for f in files:
                try:
                    fp = os.path.join(root, f)
                    if not os.path.islink(fp):
                        total += os.path.getsize(fp)
                except (PermissionError, OSError):
                    pass
    except (PermissionError, OSError):
        pass
    return total


def main():
    print("=== Windows Cleanable File Scanner ===")
    print()

    tiers = defaultdict(list)  # tier -> [(path, size, desc)]
    
    for path, tier, desc in LOCATIONS:
        if path and os.path.exists(path):
            size = get_size(path)
            if size > 0:
                tiers[tier].append((path, size, desc))

    for tier in [TIER_SAFE, TIER_CAUTION, TIER_PROTECT]:
        items = tiers.get(tier, [])
        if not items:
            continue
        
        icon = TIER_ICONS[tier]
        print(f"\n--- {icon} {tier} ---")
        items.sort(key=lambda x: x[1], reverse=True)
        tier_total = 0
        for path, size, desc in items:
            print(f"  {human(size):>10}  {desc}")
            print(f"             {path}")
            tier_total += size
        print(f"  {'':>10}  Subtotal: {human(tier_total)}")

    # Summary
    safe_total = sum(s for _, s, _ in tiers.get(TIER_SAFE, []))
    caution_total = sum(s for _, s, _ in tiers.get(TIER_CAUTION, []))
    protect_total = sum(s for _, s, _ in tiers.get(TIER_PROTECT, []))
    
    print(f"\n=== Summary ===")
    print(f"✅ Safe to delete:     {human(safe_total)}")
    print(f"⚠️  Caution:            {human(caution_total)}")
    print(f"🔒 Protect:            {human(protect_total)}")
    print(f"{'':>20} Total cleanable: {human(safe_total + caution_total)}")


if __name__ == '__main__':
    main()
