import type { PgBoss } from "pg-boss";
import { sql } from "../db.ts";
import { analyzeBusinessMaterial } from "../editorial/analyze.ts";
import { ensureQueue, QUEUES } from "./queue.ts";

/** Executes pasted-material tests through the same prefilter and evidence verifier as article analysis. */
export async function registerBusinessMatchingJobs(boss: PgBoss) {
  await ensureQueue(QUEUES.businessMatching);
  await boss.work<{ testId: string }>(QUEUES.businessMatching, { localConcurrency: 2, pollingIntervalSeconds: 2 }, async ([job]) => {
    if (!job) return;
    const [test] = await sql<{ id: string; profile_version_id: string; title: string; body: string; source_url: string | null }[]>`
      UPDATE business_matching_tests
      SET status = 'running', updated_at = now(), error = NULL
      WHERE id = ${job.data.testId} AND status = 'queued'
      RETURNING id, profile_version_id, title, body, source_url`;
    if (!test) return { status: "skipped" };
    try {
      const result = await analyzeBusinessMaterial({
        testId: test.id,
        profileVersionId: test.profile_version_id,
        title: test.title,
        body: test.body,
        url: test.source_url,
      });
      await sql`UPDATE business_matching_tests SET status = 'succeeded', result = ${sql.json(result as never)}, error = NULL, updated_at = now() WHERE id = ${test.id}`;
      return { status: "succeeded", testId: test.id };
    } catch (error) {
      const message = String(error instanceof Error ? error.message : error).slice(0, 4000);
      await sql`UPDATE business_matching_tests SET status = 'failed', error = ${message}, updated_at = now() WHERE id = ${test.id}`;
      return { status: "failed", testId: test.id, error: message };
    }
  });
}
