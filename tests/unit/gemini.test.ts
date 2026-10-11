import { describe, expect, it } from "vitest";
import { z } from "zod";
import { l2Normalize, loadPrompt, renderPrompt, toGeminiSchema } from "@/lib/gemini";
import { extractDealsResponseSchema, classifyResultSchema } from "@/pipeline/schemas";

describe("renderPrompt", () => {
  it("substitutes placeholders and refuses missing ones", () => {
    expect(renderPrompt("a {{x}} b {{ y }}", { x: "1", y: "2" })).toBe("a 1 b 2");
    expect(() => renderPrompt("{{missing}}", {})).toThrow(/missing/);
  });
});

describe("prompt files", () => {
  const cases: [string, number, string[]][] = [
    ["classify", 1, ["articles"]],
    ["extract-deal", 1, ["stages", "sectors", "articles"]],
    ["extract-event", 1, ["sectors", "articles"]],
    ["dedupe-adjudicate", 1, ["record_a", "record_b"]],
  ];
  it.each(cases)("%s.v%i renders with exactly its stage's variables", (name, version, vars) => {
    const tpl = loadPrompt({ name, version });
    const found = [...tpl.matchAll(/\{\{\s*([a-z_]+)\s*\}\}/g)].map((m) => m[1]);
    expect(new Set(found)).toEqual(new Set(vars));
    expect(() => renderPrompt(tpl, Object.fromEntries(vars.map((v) => [v, "x"])))).not.toThrow();
  });
  it("extraction prompts carry the mandatory null rule verbatim", () => {
    for (const name of ["extract-deal", "extract-event"]) {
      expect(loadPrompt({ name, version: 1 })).toContain("Return null if the article does not state this. Do not infer, estimate, or guess.");
    }
  });
});

describe("toGeminiSchema", () => {
  it("drops $schema and safe-integer bounds, keeps enums and nullability", () => {
    const s = toGeminiSchema(z.object({ n: z.number().int().nullable(), e: z.enum(["a", "b"]) })) as Record<string, unknown>;
    const json = JSON.stringify(s);
    expect(json).not.toContain("$schema");
    expect(json).not.toContain("9007199254740991");
    expect(json).toContain('"enum":["a","b"]');
    expect(json).toContain('"null"');
  });
  it("drops keywords Gemini rejects but keeps every property name", () => {
    const json = JSON.stringify(
      toGeminiSchema(z.object({ pattern: z.string().regex(/^\d{4}$/), maxItems: z.array(z.string()).max(3), n: z.number().positive() })),
    );
    expect(json).not.toMatch(/"pattern":"/);
    expect(json).not.toContain('"maxItems":3');
    expect(json).not.toContain("exclusiveMinimum");
    expect(json).toContain('"properties":{"pattern"');
    expect(json).toContain('"maxItems":{');
  });
  it("constrains sector and stage to the taxonomy in the extraction schema", () => {
    const json = JSON.stringify(toGeminiSchema(extractDealsResponseSchema));
    expect(json).toContain('"Fintech"');
    expect(json).toContain('"Pre-Series A"');
    expect(JSON.stringify(toGeminiSchema(classifyResultSchema))).toContain('"fund_close"');
  });
});

describe("l2Normalize", () => {
  it("produces unit vectors and leaves zero vectors alone", () => {
    const v = l2Normalize([3, 4]);
    expect(v[0]).toBeCloseTo(0.6);
    expect(v[1]).toBeCloseTo(0.8);
    expect(l2Normalize([0, 0])).toEqual([0, 0]);
  });
});
