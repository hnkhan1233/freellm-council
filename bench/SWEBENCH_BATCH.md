# SWE-bench batch — measure the Claude-base council lift (fresh session runbook)

**Goal:** the first real **Claude-base lift** number on SWE-bench. We proved the no-Docker
pipeline works (`sympy__sympy-20212` RESOLVED, council 4/4 approved). On that easy instance
Claude had no headroom (+0). This batch uses **harder sympy instances** so Claude actually
fails some — that's where the council's critique→revise loop can show a lift, exactly as the
free-model arm did (+33pp).

## Two arms to record per instance
- **Arm A (Claude solo):** does Claude's FIRST patch resolve it? (FAIL_TO_PASS pass + all PASS_TO_PASS pass)
- **Arm B (Claude + council):** after the council reviews Arm A's patch and Claude revises, does the FINAL patch resolve it?
- **Lift = instances Arm A fails but Arm B resolves** (council caught a real bug) — minus any regressions.

## Environment (persists from prior session)
- conda env **`swebench`** (py3.9), sympy clone at **`/tmp/swe/sympy`**, dataset **`/tmp/swe_lite.parquet`** (re-fetch if missing — URL in prior session / HF `princeton-nlp/SWE-bench_Lite`).
- Council CLI: `cd ~/Documents/FreeLLMAssistant && node src/cli.mjs -t code -q "..." -f <ctx>`

## The 15 instances (`/tmp/swe_batch.txt`)
```
sympy__sympy-14308  sympy__sympy-18199  sympy__sympy-20322  sympy__sympy-20049
sympy__sympy-23191  sympy__sympy-20639  sympy__sympy-19254  sympy__sympy-14317
sympy__sympy-16792  sympy__sympy-15011  sympy__sympy-23117  sympy__sympy-19007
sympy__sympy-18835  sympy__sympy-20154  sympy__sympy-18087
```

## Per-instance recipe (proven on 20212)
Extract fields from the parquet (writes problem.md/test.patch/meta.json under `/tmp/swe/<id>/`):
```python
import sys,json,ast,pandas as pd
iid='sympy__sympy-XXXXX'; import os; meta=f'/tmp/swe/{iid}'; os.makedirs(meta,exist_ok=True)
r=pd.read_parquet('/tmp/swe_lite.parquet').set_index('instance_id').loc[iid]
open(meta+'/problem.md','w').write(r['problem_statement']); open(meta+'/test.patch','w').write(r['test_patch'])
g=lambda x: ast.literal_eval(x) if isinstance(x,str) else list(x)
json.dump({'base':r['base_commit'],'f2p':g(r['FAIL_TO_PASS']),'p2p':g(r['PASS_TO_PASS'])},open(meta+'/meta.json','w'))
```
Then (bash; `source ~/miniconda3/etc/profile.d/conda.sh && conda activate swebench`):
1. `cd /tmp/swe/sympy && git checkout -f -q <base> && pip install -e . -q`
2. `git apply /tmp/swe/<id>/test.patch`  (adds the failing test)
3. **Baseline:** run each FAIL_TO_PASS (`python -m pytest -q -k "<name>"` or find the file) → must **FAIL**.
4. **Claude solves** from `problem.md` ONLY (do NOT read the gold patch). Edit the sympy source. `git diff <file> > /tmp/swe/<id>/A.diff` = Arm A patch.
5. **Verify Arm A:** F2P pass? all PASS_TO_PASS pass? → record resolved/not.
6. **Council:** build ctx (problem + relevant code + A.diff), `node src/cli.mjs -t code -q "review this fix..." -f ctx`.
7. **Claude weighs** the critiques; if a concern is valid, revise → `B.diff`. **Verify Arm B.**
8. Record: instance, A_resolved, B_resolved, council_verdicts.

## Output
A table: per-instance A_resolved / B_resolved, totals = **Arm A pass@1 vs Arm B pass@1**, and the
list of instances where the council flipped fail→resolve (the genuine lift) and any regressions.
Caveat to report: sympy-only, N=15, free-tier nondeterminism → directional.
