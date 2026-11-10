import { describe, expect, it } from "vitest";
import { pickTrainers } from "../trainTool/jobs";

const sd = "D:\\fluxgym\\sd-scripts";
const procs = [
  { pid: 10, name: "python.exe", cmd: `D:\\fluxgym\\env\\python.exe -m accelerate.commands.accelerate_cli launch --num_cpu_threads_per_process 2 ${sd}\\sdxl_train_network.py --config_file x.toml` },
  { pid: 11, name: "python.exe", cmd: `"D:\\fluxgym\\env\\python.exe" "${sd}\\train_network.py" --x` },
  { pid: 12, name: "python.exe", cmd: `python ${sd}\\flux_train_network.py` },
  { pid: 20, name: "bash.exe", cmd: `bash -c "grep train_network.py ${sd}\\train_network.py"` },
  { pid: 21, name: "powershell.exe", cmd: `powershell -Command "$_.CommandLine -like '*train_network.py*'"` },
  { pid: 22, name: "node.exe", cmd: `node tsx server.ts  train_network.py` },
  { pid: 23, name: "python.exe", cmd: "python other_script.py" },
  { pid: 99, name: "python.exe", cmd: `python ${sd}\\train_network.py` },
];

describe("pickTrainers", () => {
  it("matches only real trainer python processes, not wrappers or itself", () => {
    expect(pickTrainers(procs, "train_network.py", 99)).toEqual([10, 11, 12]);
  });
});
