"""Starts Downtify with the fast audio fetch installed. Takes the same arguments as Downtify's main.py."""

import runpy
import sys
import traceback

sys.path.insert(0, '/downtify')
sys.path.insert(0, '/patch')

# A Downtify update that renames what the patch hooks must leave Downtify running as it was, not stop it.
try:
    import fast_fetch

    fast_fetch.install()
except Exception:
    traceback.print_exc()
    print('fast_fetch is not installed; Downtify runs unpatched', flush=True)

sys.argv[0] = '/downtify/main.py'
runpy.run_path('/downtify/main.py', run_name='__main__')
