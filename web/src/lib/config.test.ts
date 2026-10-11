import { describe, expect, it } from "vitest";
import {
  buildExport, draftsFromImport, mergeSources, pruneSyncedDrafts, validateRules, validateSource, validateSourcesConfig,
} from "./config";
import { DEFAULT_RULES } from "./data";
import type { Source, SourcesConfig } from "./types";

const cloud: SourcesConfig = {
  version: 1,
  categories: [{ id: "ai", name: "AI" }, { id: "jobs", name: "招聘" }],
  sources: [
    { id: "feed-a", name: "A", type: "rss", url: "https://a.example.com/feed", category: "ai", keywords: ["x"] },
    { id: "page-b", name: "B", type: "html", url: "https://b.example.com", category: "jobs", html: { selector: "#main" } },
  ],
};
const noDrafts = { upserts: [], deletes: [], categories: [] };

describe("validateSource", () => {
  const cats = new Set(["ai"]);
  it("accepts a valid source", () => {
    expect(validateSource(cloud.sources[0], cats)).toEqual([]);
  });
  it("rejects bad id, url, category and unknown fields", () => {
    const errs = validateSource({ id: "Bad Id", name: "x", type: "rss", url: "ftp://x", category: "nope", foo: 1 }, cats);
    expect(errs.join("\n")).toMatch(/id/);
    expect(errs.join("\n")).toMatch(/url/);
    expect(errs.join("\n")).toMatch(/分类/);
    expect(errs.join("\n")).toMatch(/未知字段 "foo"/);
  });
  it("requires html.selector and api mapping", () => {
    expect(validateSource({ id: "pp", name: "p", type: "html", url: "https://x", category: "ai" }, cats).join()).toMatch(/selector/);
    expect(validateSource({ id: "pp", name: "p", type: "api", url: "https://x", category: "ai" }, cats).join()).toMatch(/api/);
  });
  it("only allows daily frequency in v1", () => {
    expect(validateSource({ ...cloud.sources[0], frequency: "hourly" }, cats).join()).toMatch(/daily/);
  });
  it("validates github urls and regexes", () => {
    expect(validateSource({ id: "gh", name: "g", type: "github_releases", url: "https://gitlab.com/a/b", category: "ai" }, cats)).toHaveLength(1);
    expect(validateSource({ ...cloud.sources[0], ignore_patterns: ["("] }, cats).join()).toMatch(/正则/);
  });
});

describe("validateSourcesConfig", () => {
  it("detects duplicate ids", () => {
    const r = validateSourcesConfig({ ...cloud, sources: [cloud.sources[0], cloud.sources[0]] });
    expect(r.ok).toBe(false);
    expect(r.errors.join()).toMatch(/重复/);
  });
  it("rejects non-objects", () => {
    expect(validateSourcesConfig("x").ok).toBe(false);
  });
});

describe("drafts and sync state", () => {
  const newSrc: Source = { id: "new-one", name: "N", type: "rss", url: "https://n.example.com/rss", category: "ai" };

  it("marks new, modified and deleted drafts", () => {
    const merged = mergeSources(cloud, {
      upserts: [{ ...cloud.sources[0], name: "A2" }, newSrc], deletes: ["page-b"], categories: [],
    });
    expect(merged.map((m) => [m.source.id, m.sync])).toEqual([
      ["feed-a", "draft-modified"], ["page-b", "draft-delete"], ["new-one", "draft-new"],
    ]);
  });

  it("prunes drafts that the deployed config already contains (synced)", () => {
    const synced = { ...cloud, sources: [...cloud.sources, newSrc] };
    const pruned = pruneSyncedDrafts(synced, { upserts: [newSrc, cloud.sources[0]], deletes: ["gone"], categories: [] });
    expect(pruned).toEqual(noDrafts);
  });

  it("treats empty arrays/undefined as equal when pruning", () => {
    const pruned = pruneSyncedDrafts(cloud, { upserts: [{ ...cloud.sources[1], exclude_keywords: [], notes: "" }], deletes: [], categories: [] });
    expect(pruned.upserts).toEqual([]);
  });

  it("export applies drafts and drops deletions", () => {
    const out = buildExport(cloud, { upserts: [newSrc], deletes: ["feed-a"], categories: [{ id: "x", name: "X" }] });
    expect(out.sources.map((s) => s.id)).toEqual(["page-b", "new-one"]);
    expect(out.categories.map((c) => c.id)).toEqual(["ai", "jobs", "x"]);
    expect(validateSourcesConfig(out).ok).toBe(true);
  });

  it("import computes the diff against cloud", () => {
    const imported: SourcesConfig = { ...cloud, sources: [cloud.sources[0], newSrc] };
    const d = draftsFromImport(cloud, imported);
    expect(d.upserts.map((s) => s.id)).toEqual(["new-one"]);
    expect(d.deletes).toEqual(["page-b"]);
  });

  it("export with no drafts round-trips the cloud config", () => {
    expect(buildExport(cloud, noDrafts)).toEqual(cloud);
  });
});

describe("validateRules", () => {
  it("accepts defaults", () => expect(validateRules(DEFAULT_RULES).ok).toBe(true));
  it("rejects inverted thresholds and bad timezone", () => {
    const r = validateRules({ ...DEFAULT_RULES, levels: { high: 40, medium: 60 }, timezone: "Mars/Base" });
    expect(r.errors.length).toBe(2);
  });
});

describe("v0.2 config fields", () => {
  const cats = new Set(["ai"]);
  it("accepts profile/company/industry and rejects bad profiles", () => {
    const ok = { id: "pp", name: "p", type: "html", url: "https://x", category: "ai", profile: "pricing", company: "X", html: { selector: "main" } };
    expect(validateSource(ok, cats)).toEqual([]);
    expect(validateSource({ ...ok, profile: "weird" }, cats).join()).toMatch(/模块类型/);
    expect(validateSource({ ...ok, type: "rss", html: undefined }, cats).join()).toMatch(/定价页/);
  });
  it("validates keyword groups", () => {
    expect(validateRules({ ...DEFAULT_RULES, keyword_groups: { 供应链: ["supply chain"] }, job_functions: ["供应链"] }).ok).toBe(true);
    expect(validateRules({ ...DEFAULT_RULES, keyword_groups: { 供应链: "supply chain" } as never }).ok).toBe(false);
  });
});
