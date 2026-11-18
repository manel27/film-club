"""Launcher for ``python3 -I`` (isolated mode adds neither the current nor the
script directory to ``sys.path``). It adds only the repository root, which is
trusted code, then runs :func:`migration.cli.main`.

    python3 -I migration/run.py all --sheet <export.html> --out migration/out
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from migration.cli import main  # noqa: E402

if __name__ == "__main__":
    sys.exit(main())
