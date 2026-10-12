#!/usr/bin/env python3
"""Game file scanner - identifies and classifies game directories."""

import os
import sys
import argparse
from collections import defaultdict

GAME_KEYWORDS = ['steam', 'epic', 'gog', 'origin', 'uplay', 'battlenet', 'riot', 'minecraft', 'roblox', 'blizzard']
PLATFORM_PATHS = {
    'Steam': ['steam/steamapps', 'SteamLibrary'],
    'Epic': ['EpicGamesLauncher', 'Epic Games'],
    'GOG': ['GOG Games', 'GOG.com'],
    'EA': ['Electronic Arts', 'EA Games', 'Origin'],
    'Ubisoft': ['Ubisoft', 'Ubisoft Connect'],
    'Blizzard': ['Blizzard Entertainment', 'Battle.net'],
    'Riot': ['Riot Games'],
    'Microsoft': ['WindowsApps', 'XboxGames'],
}

def human(n):
    for unit in ['B', 'KB', 'MB', 'GB', 'TB']:
        if abs(n) < 1024.0:
            return f"{n:.1f} {unit}"
        n /= 1024.0
    return f"{n:.1f} PB"

def scan_games(path):
    """Scan for game directories."""
    games = []
    
    for root, dirs, files in os.walk(path, followlinks=False):
        dirs[:] = [d for d in dirs if not os.path.islink(os.path.join(root, d))]
        
        dirname = os.path.basename(root).lower()
        
        # Check if this looks like a game directory
        is_game = any(kw in dirname for kw in GAME_KEYWORDS)
        is_game = is_game or any(kw in root.lower() for kw in ['games', 'game', 'steamapps'])
        
        if is_game:
            total_size = 0
            file_count = 0
            ext_sizes = defaultdict(int)
            
            for f in files:
                fp = os.path.join(root, f)
                try:
                    if os.path.islink(fp):
                        continue
                    sz = os.path.getsize(fp)
                    total_size += sz
                    file_count += 1
                    ext = os.path.splitext(f)[1].lower() or '(no ext)'
                    ext_sizes[ext] += sz
                except:
                    pass
            
            if total_size > 100 * 1024 * 1024:  # > 100MB
                # Detect platform
                platform = 'Unknown'
                for plat, paths in PLATFORM_PATHS.items():
                    if any(p.lower() in root.lower() for p in paths):
                        platform = plat
                        break
                
                games.append({
                    'path': root,
                    'size': total_size,
                    'files': file_count,
                    'platform': platform,
                    'ext_sizes': dict(ext_sizes)
                })
    
    return games

def main():
    parser = argparse.ArgumentParser(description='Game file scanner')
    parser.add_argument('--path', default='C:\\', help='Path to scan')
    args = parser.parse_args()
    
    path = os.path.normpath(args.path)
    print(f"Scanning for games in {path} ...")
    print()
    
    games = scan_games(path)
    games.sort(key=lambda x: x['size'], reverse=True)
    
    print(f"=== Found {len(games)} Game Directories ===")
    print()
    
    total_game_size = 0
    for g in games:
        total_game_size += g['size']
        print(f"  {human(g['size']):>10}  [{g['platform']}] {g['path']}")
        print(f"             {g['files']} files")
        
        # Top file types
        sorted_ext = sorted(g['ext_sizes'].items(), key=lambda x: x[1], reverse=True)[:5]
        for ext, sz in sorted_ext:
            print(f"             {ext}: {human(sz)}")
        print()
    
    print(f"=== Summary ===")
    print(f"Total game space: {human(total_game_size)}")
    print(f"Game directories: {len(games)}")

if __name__ == "__main__":
    main()
