"""Measure the command and all terminated descendants without third-party packages."""
import json
import resource
import subprocess
import sys
import time
started = time.monotonic()
result = subprocess.run(sys.argv[2:], check=False)
usage = resource.getrusage(resource.RUSAGE_CHILDREN)
with open(sys.argv[1], 'w', encoding='utf-8') as output:
    json.dump(dict(elapsed_seconds=time.monotonic()-started, user_cpu=usage.ru_utime,
                   system_cpu=usage.ru_stime, max_rss_kib=usage.ru_maxrss,
                   voluntary_switches=usage.ru_nvcsw, involuntary_switches=usage.ru_nivcsw,
                   major_faults=usage.ru_majflt, exit_code=result.returncode), output, indent=2)
sys.exit(result.returncode)
