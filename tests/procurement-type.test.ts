import assert from "node:assert/strict";
import { test } from "node:test";
import { isAwardResultTitle } from "@aihot/industry/taxonomy";

test("award and transaction-result headlines are distinguished from current bid notices", () => {
  for (const title of [
    "中标公告：城市基础地理数据服务",
    "项目中标候选人公示",
    "水利系统中标人公示",
    "档案服务成交供应商公示",
    "系统运维成交结果公告",
    "服务采购成交公示",
    "服务采购成交候选公示",
    "2026年无为市公安局移动警务系统和应用采购项目合同公示",
    "政府采购合同公告",
    "采购结果公告",
    "招标结果公示",
    "评标结果公示",
  ]) assert.equal(isAwardResultTitle(title), true, title);

  for (const title of [
    "城市基础地理数据服务招标公告",
    "采购意向公开",
    "招标计划公告",
    "项目资格预审公告",
  ]) assert.equal(isAwardResultTitle(title), false, title);
});
