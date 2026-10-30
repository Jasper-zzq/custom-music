import test from "node:test";
import assert from "node:assert/strict";
import { searchBatch, type SearchOutcome } from "../src/parallel-search.js";
test("多个音源同时启动，快结果先显示，慢请求不阻塞其他音源", async () => {
  const started: string[] = [];
  const outcomes: SearchOutcome[] = [];
  const replies = new Map<string, (value: any) => void>();
  const pending = searchBatch(
    [
      { source: "tx", page: 1 },
      { source: "wy", page: 2 },
      { source: "kw", page: 1 },
    ],
    "晴天",
    "music",
    async (source, method, args) => {
      started.push(source);
      assert.equal(method, "search");
      assert.equal(args[0], "晴天");
      return new Promise((resolve) => replies.set(source, resolve));
    },
    (result) => outcomes.push(result),
  );
  assert.deepEqual(started, ["tx", "wy", "kw"]);
  replies.get("wy")!({ data: [{ id: "1", title: "晴天" }], isEnd: false });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(outcomes.length, 1);
  assert.equal(outcomes[0].source, "wy");
  assert.equal(outcomes[0].page, 2);
  replies.get("tx")!({ data: [], isEnd: true });
  replies.get("kw")!({ data: [], isEnd: true });
  await pending;
  assert.equal(outcomes.length, 3);
});
test("单个音源失败保留成功结果，错误响应不导致整个搜索失败", async () => {
  const outcomes: SearchOutcome[] = [];
  await searchBatch(
    [
      { source: "tx", page: 1 },
      { source: "mg", page: 1 },
      { source: "kg", page: 1 },
    ],
    "测试",
    "music",
    async (source) => {
      if (source === "mg") throw new Error("上游接口失效");
      if (source === "kg") return { bad: true };
      return { data: [{ id: "1" }], isEnd: true };
    },
    (result) => outcomes.push(result),
  );
  assert.equal(outcomes.find((o) => o.source === "tx")!.items.length, 1);
  assert.match(outcomes.find((o) => o.source === "mg")!.error, /失效/);
  assert.match(outcomes.find((o) => o.source === "kg")!.error, /不兼容/);
});
