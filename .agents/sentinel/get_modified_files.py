import os

def main():
    root_dir = "d:/Projects/buddysaradhi/buddysaradhi"
    files = []
    
    # Excluded folders
    excludes = [".git", "node_modules", ".agents", ".next", "dist", "build"]
    
    for dirpath, dirnames, filenames in os.walk(root_dir):
        # Prune excluded directories
        dirnames[:] = [d for d in dirnames if d not in excludes]
        
        for f in filenames:
            fullpath = os.path.join(dirpath, f)
            try:
                mtime = os.path.getmtime(fullpath)
                files.append((mtime, fullpath))
            except OSError:
                pass
                
    # Sort files by modification time descending
    files.sort(key=lambda x: x[0], reverse=True)
    
    print("--- TOP 5 MODIFIED FILES ---")
    for mtime, path in files[:5]:
        import datetime
        dt = datetime.datetime.fromtimestamp(mtime, datetime.timezone.utc)
        print(f"{dt.isoformat()} {path}")

if __name__ == "__main__":
    main()
