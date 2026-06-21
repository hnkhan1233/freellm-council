#!/usr/bin/env python3
# HumanEval scorer. Executes each solution against its problem's official test in
# a subprocess with a timeout, computes pass@1. NOTE: this runs generated code —
# intended for trusted solutions (Claude's / the council's) on a throwaway run.
import json, sys, subprocess, argparse

ap = argparse.ArgumentParser()
ap.add_argument('--problems', required=True)   # jsonl with task_id, test, entry_point
ap.add_argument('--solutions', required=True)  # json: {task_id: full_solution_code}
ap.add_argument('--timeout', type=float, default=12)
args = ap.parse_args()

probs = {}
for line in open(args.problems):
    line = line.strip()
    if line:
        p = json.loads(line); probs[p['task_id']] = p
sols = json.load(open(args.solutions))

results = {}; npass = 0
for tid, code in sols.items():
    p = probs.get(tid)
    if not p:
        results[tid] = {'pass': False, 'err': 'unknown task_id'}; continue
    program = code + "\n\n" + p['test'] + f"\n\ncheck({p['entry_point']})\n"
    try:
        r = subprocess.run([sys.executable, '-c', program], capture_output=True, timeout=args.timeout, text=True)
        ok = (r.returncode == 0)
        err = '' if ok else (r.stderr.strip().split('\n')[-1] if r.stderr.strip() else f'exit {r.returncode}')
        results[tid] = {'pass': ok, 'err': err}
    except subprocess.TimeoutExpired:
        results[tid] = {'pass': False, 'err': 'timeout'}
    if results[tid]['pass']: npass += 1

n = len(sols)
print(f"pass@1: {npass}/{n} = {100*npass/max(n,1):.1f}%")
for tid in sols:
    r = results[tid]
    print(f"  {'PASS' if r['pass'] else 'FAIL'}  {tid}" + ('' if r['pass'] else f"   [{r['err'][:90]}]"))
json.dump(results, open(args.solutions.replace('.json', '.results.json'), 'w'), indent=2)
