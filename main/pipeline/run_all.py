"""Run the whole pipeline: python run_all.py  (each step is cached and re-runnable)."""
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
STEPS = ["zones.py", "age.py", "social.py", "services.py", "funded.py", "build.py", "planner_ref.py"]

failed = []
for s in STEPS:
    if not (HERE / s).exists():
        print(f"-- skip {s} (missing)")
        continue
    print(f"== {s}")
    r = subprocess.run([sys.executable, str(HERE / s)], cwd=HERE)
    if r.returncode != 0:
        failed.append(s)
        print(f"!! {s} failed with code {r.returncode}")
print("failed steps:", failed or "none")
sys.exit(1 if failed else 0)
