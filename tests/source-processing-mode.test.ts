import assert from "node:assert/strict";
import { test } from "node:test";
import { processingModeOf, withProcessingMode } from "@aihot/backend/sources/processing-mode";
import { unsupportedConfig } from "@aihot/backend/sources/config-keys";

test("公众号默认仅采集，明确选择后才分析", () => {
  assert.equal(processingModeOf("mp_account", { ghid: "gh_1" }), "collect_only");
  assert.equal(processingModeOf("mp_account", { _aihot: { processingMode: "collect_and_analyze" } }), "collect_and_analyze");
  assert.equal(processingModeOf("rss", {}), "collect_and_analyze");
});

test("处理方式写入 _aihot 且保留既有配置", () => {
  assert.deepEqual(withProcessingMode({ ghid: "gh_1", _aihot: { maxAgeDays: 30 } }, "collect_only"), {
    ghid: "gh_1",
    _aihot: { maxAgeDays: 30, processingMode: "collect_only" },
  });
});

test("处理方式只接受两个明确值", () => {
  assert.deepEqual(unsupportedConfig("mp_account", { _aihot: { processingMode: "unknown" } }), ["_aihot.processingMode=unknown"]);
  assert.deepEqual(unsupportedConfig("mp_account", { _aihot: { processingMode: "collect_only" } }), []);
});
