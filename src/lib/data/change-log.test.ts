import assert from "node:assert/strict";
import test from "node:test";
import { diffSnapshots, menuSnapshot } from "./change-log.ts";

test("machine snapshots report field-level menu changes", () => {
  const before = menuSnapshot({ diy: [{ position: 1, goodsName: "Vanilla", price: "3", imagePath: "old.jpg" }], unify: [] });
  const after = menuSnapshot({ diy: [{ position: 1, goodsName: "Vanilla", price: "4", imagePath: "new.jpg" }], unify: [] });

  assert.deepEqual(diffSnapshots(before, after), [
    { entityKey: "diy:1", field: "price", oldValue: "3", newValue: "4" },
    { entityKey: "diy:1", field: "imagePath", oldValue: "old.jpg", newValue: "new.jpg" },
  ]);
});
