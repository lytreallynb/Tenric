"""Environment probe for the runtime's collector.

Standard library only, and it imports nothing from the workspace: it reports
the interpreter, the installed distributions, and where a file inside an
installed package is, without importing that package.
"""
import importlib.metadata
import importlib.util
import json
import platform
import sys
from pathlib import Path

located = None
if len(sys.argv) > 1:
    package, _, rest = sys.argv[1].partition("/")
    spec = importlib.util.find_spec(package)
    if spec is not None and spec.submodule_search_locations:
        candidate = Path(list(spec.submodule_search_locations)[0]) / rest
        if candidate.is_file():
            distributions = importlib.metadata.packages_distributions().get(package, [])
            located = {
                "path": str(candidate),
                "distribution": distributions[0] if distributions else None,
                "version": importlib.metadata.version(distributions[0]) if distributions else None,
            }

sys.stdout.write(json.dumps({
    "os": platform.system(),
    "os_release": platform.release(),
    "arch": platform.machine(),
    "python": platform.python_version(),
    "python_implementation": platform.python_implementation(),
    "packages": {d.metadata["Name"].lower(): d.version for d in importlib.metadata.distributions() if d.metadata["Name"]},
    "located": located,
}, sort_keys=True))
