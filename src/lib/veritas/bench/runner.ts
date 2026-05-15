/**
 * ForgeBench-Reason — run harness.
 *
 * Wires a BenchRunner (the thing that actually calls a model) through a set of
 * tasks and collects grades. The runner never mutates tasks or context; the
 * same task pack can be shared across models so results are directly
 * comparable.
 *
 * Everything here is async-safe and concurrency-bounded — we don't want a
 * 1 000-task pack to open 1 000 simultaneous LLM calls.
 */

import type {
  BenchGrade,
  BenchRun,
  BenchRunner,
  BenchSuiteId,
  BenchSuiteSummary,
  BenchTask,
} from "./types";
import { gradeTask, summariseSuite } from "./grader";

export interface RunOptions {
  /** Max tasks in-flight simultaneously. Defaults to 4. */
  concurrency?: number;
  /** Called after each task completes — useful for live dashboards. */
  onProgress?: (grade: BenchGrade, task: BenchTask) => void;
  /** Abort mid-run. */
  signal?: AbortSignal;
}

const SUITES: BenchSuiteId[] = [
  "contra-detect",
  "memory-recall",
  "reasoning-chain",
  "conversation",
  "citation",
  "abstention",
];

export async function runBench(
  tasks: BenchTask[],
  runner: BenchRunner,
  opts: RunOptions = {},
): Promise<BenchRun> {
  const concurrency = Math.max(1, opts.concurrency ?? 4);
  const startedAt = new Date().toISOString();
  const grades: BenchGrade[] = new Array(tasks.length);

  let cursor = 0;
  const workers: Promise<void>[] = [];

  const work = async () => {
    while (true) {
      if (opts.signal?.aborted) return;
      const i = cursor++;
      if (i >= tasks.length) return;
      const task = tasks[i];
      try {
        const response = await runner.run(task);
        const grade = gradeTask(task, response);
        grades[i] = grade;
        opts.onProgress?.(grade, task);
      } catch (err) {
        const detail = err instanceof Error ? err.message : "runner threw";
        const grade: BenchGrade = {
          taskId: task.id,
          suite: task.suite,
          score: 0,
          passed: false,
          malformed: true,
          criteria: [{ name: "runner-error", score: 0, detail }],
        };
        grades[i] = grade;
        opts.onProgress?.(grade, task);
      }
    }
  };

  for (let k = 0; k < concurrency; k++) workers.push(work());
  await Promise.all(workers);

  const densifiedGrades = grades.filter(Boolean);
  const summaries: BenchSuiteSummary[] = SUITES.map((s) => summariseSuite(s, densifiedGrades, tasks));

  let totalScore = 0;
  let passCount = 0;
  for (const g of densifiedGrades) {
    totalScore += g.score;
    if (g.passed) passCount++;
  }

  return {
    model: runner.modelId,
    startedAt,
    finishedAt: new Date().toISOString(),
    grades: densifiedGrades,
    summaries,
    overall: {
      taskCount: densifiedGrades.length,
      passCount,
      avgScore: densifiedGrades.length === 0 ? 0 : totalScore / densifiedGrades.length,
    },
  };
}
