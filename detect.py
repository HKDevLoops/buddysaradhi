import os
from collections import Counter

INPUT_PATH = "."
SENSITIVE = {
    ".env",
    ".git",
    ".venv",
    "node_modules",
    "__pycache__",
    ".idea",
    ".vscode",
    ".cache",
    "dist",
    "build",
    ".next",
    ".nuxt",
    ".turbo",
    ".gradle",
    "vendor",
    ".terraform",
}
EXTS = {
    ".md",
    ".txt",
    ".py",
    ".js",
    ".ts",
    ".tsx",
    ".jsx",
    ".java",
    ".go",
    ".rs",
    ".c",
    ".cpp",
    ".h",
    ".cs",
    ".rb",
    ".php",
    ".sql",
    ".json",
    ".yaml",
    ".yml",
    ".toml",
    ".sh",
    ".r",
    ".m",
    ".astro",
    ".vue",
}
results = []
for root, dirs, files in os.walk(INPUT_PATH):
    dirs[:] = [d for d in dirs if d.lower() not in SENSITIVE]
    for f in files:
        p = os.path.join(root, f)
        try:
            if os.path.splitext(f)[1].lower() in EXTS:
                results.append((os.path.getsize(p), p))
        except Exception:
            pass
results.sort(reverse=True)
total = len(results)
total_bytes = sum(b for b, _ in results)
print("TOTAL_FILES", total)
print("TOTAL_BYTES", total_bytes)
print("--- TOP 25 BY BYTES ---")
for b, p in results[:25]:
    print(b, p.replace(".\\", "").replace("./", ""))
c = Counter()
for _, p in results:
    parts = p.replace(".\\", "").replace("./", "").split(os.sep)
    c[parts[0] if len(parts) > 1 else "(root)"] += 1
print("--- TOP SUBDIRS BY COUNT ---")
for d, n in c.most_common(12):
    print(n, d)
