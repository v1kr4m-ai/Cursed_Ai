"""Runs FaceFusion (faceswap/facefusion) with the CUDA / cuDNN DLLs from the env's nvidia pip packages on the search path.

Usage: python facefusion_run.py <facefusion dir> <facefusion args...>
"""
import os
import runpy
import sys
import sysconfig

ff_dir = os.path.abspath(sys.argv[1])
nvidia = os.path.join(sysconfig.get_paths()["purelib"], "nvidia")
if os.path.isdir(nvidia):
    for pkg in os.listdir(nvidia):
        for sub in ("bin", "lib"):
            d = os.path.join(nvidia, pkg, sub)
            if os.path.isdir(d):
                os.environ["PATH"] = d + os.pathsep + os.environ.get("PATH", "")
                if hasattr(os, "add_dll_directory"):
                    os.add_dll_directory(d)

os.chdir(ff_dir)
sys.path.insert(0, ff_dir)
sys.argv = [os.path.join(ff_dir, "facefusion.py")] + sys.argv[2:]
runpy.run_path(sys.argv[0], run_name="__main__")
