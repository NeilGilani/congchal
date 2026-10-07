"""Minimal stand-in for the parts of TensorFlow that big_vision uses for file IO (parity check only)."""
import builtins, os, glob as _glob
GFile = builtins.open
exists = os.path.exists
makedirs = lambda p: os.makedirs(p, exist_ok=True)
glob = _glob.glob
