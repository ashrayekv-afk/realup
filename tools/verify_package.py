"""Verify the distributed files against FILE_MANIFEST.json (not a security signature)."""
from pathlib import Path
import hashlib, json, sys
root = Path(__file__).resolve().parents[1]
manifest = json.loads((root / "FILE_MANIFEST.json").read_text())
errors = []
for item in manifest["files"]:
    path = root / item["path"]
    if not path.is_file() or hashlib.sha256(path.read_bytes()).hexdigest() != item["sha256"]:
        errors.append(item["path"])
if errors:
    print("Missing or changed: " + ", ".join(errors))
    sys.exit(1)
print(f"Verified {len(manifest['files'])} distributed files.")
