import { describe, expect, it } from "vitest";
import { groupsToText, textToGroups } from "../pages/Rules";

describe("synonym group text format", () => {
  it("round-trips and accepts Chinese punctuation", () => {
    const g = { 供应链: ["supply chain", "SCM"], 采购: ["procurement"] };
    expect(textToGroups(groupsToText(g))).toEqual(g);
    expect(textToGroups("物流： logistics，运输\n无效行\n: x")).toEqual({ 物流: ["logistics", "运输"] });
  });
});
