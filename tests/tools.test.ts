import { describe, it, expect } from "vitest";
import { SEARCH_AI_TOOL } from "../src/tools/search-tool.js";
import {
  GOOGLE_AI_SEARCH_PROMPT,
  GOOGLE_AI_SEARCH_PROMPT_TEMPLATE,
} from "../src/tools/search-prompt.js";

describe("SEARCH_AI_TOOL", () => {
  it("has name 'search_ai'", () => {
    expect(SEARCH_AI_TOOL.name).toBe("search_ai");
  });

  it("has a description", () => {
    expect(SEARCH_AI_TOOL.description).toBeTruthy();
    expect(SEARCH_AI_TOOL.description.length).toBeGreaterThan(50);
  });

  it("mentions Google AI Mode in description", () => {
    expect(SEARCH_AI_TOOL.description.toLowerCase()).toContain("google ai");
  });

  it("has correct input schema type", () => {
    expect(SEARCH_AI_TOOL.inputSchema.type).toBe("object");
  });

  it("requires 'query' parameter", () => {
    expect(SEARCH_AI_TOOL.inputSchema.required).toContain("query");
  });

  it("has 'query' property as string", () => {
    const props = SEARCH_AI_TOOL.inputSchema.properties as any;
    expect(props.query).toBeDefined();
    expect(props.query.type).toBe("string");
  });

  it("has optional 'headless' boolean parameter", () => {
    const props = SEARCH_AI_TOOL.inputSchema.properties as any;
    expect(props.headless).toBeDefined();
    expect(props.headless.type).toBe("boolean");
  });

  it("has optional 'timeout_ms' number parameter", () => {
    const props = SEARCH_AI_TOOL.inputSchema.properties as any;
    expect(props.timeout_ms).toBeDefined();
    expect(props.timeout_ms.type).toBe("number");
  });

  it("has optional 'save_to_file' boolean parameter", () => {
    const props = SEARCH_AI_TOOL.inputSchema.properties as any;
    expect(props.save_to_file).toBeDefined();
    expect(props.save_to_file.type).toBe("boolean");
  });

  it("has optional 'filename' string parameter", () => {
    const props = SEARCH_AI_TOOL.inputSchema.properties as any;
    expect(props.filename).toBeDefined();
    expect(props.filename.type).toBe("string");
  });

  it("only requires 'query'", () => {
    expect(SEARCH_AI_TOOL.inputSchema.required).toEqual(["query"]);
  });
});

describe("GOOGLE_AI_SEARCH_PROMPT", () => {
  it("has name 'google-ai-search-guide'", () => {
    expect(GOOGLE_AI_SEARCH_PROMPT.name).toBe("google-ai-search-guide");
  });

  it("has a description", () => {
    expect(GOOGLE_AI_SEARCH_PROMPT.description).toBeTruthy();
  });

  it("has 'user_query' argument marked required", () => {
    expect(GOOGLE_AI_SEARCH_PROMPT.arguments).toBeDefined();
    expect(GOOGLE_AI_SEARCH_PROMPT.arguments.length).toBe(1);
    expect(GOOGLE_AI_SEARCH_PROMPT.arguments[0].name).toBe("user_query");
    expect(GOOGLE_AI_SEARCH_PROMPT.arguments[0].required).toBe(true);
  });
});

describe("GOOGLE_AI_SEARCH_PROMPT_TEMPLATE", () => {
  it("contains query optimization guidance", () => {
    expect(GOOGLE_AI_SEARCH_PROMPT_TEMPLATE).toContain("Optimization");
    expect(GOOGLE_AI_SEARCH_PROMPT_TEMPLATE).toContain("query");
  });

  it("contains user_query placeholder", () => {
    expect(GOOGLE_AI_SEARCH_PROMPT_TEMPLATE).toContain("{{user_query}}");
  });

  it("includes examples of optimized queries", () => {
    expect(GOOGLE_AI_SEARCH_PROMPT_TEMPLATE).toContain("Example 1");
    expect(GOOGLE_AI_SEARCH_PROMPT_TEMPLATE).toContain("Example 2");
  });

  it("mentions save_to_file feature", () => {
    expect(GOOGLE_AI_SEARCH_PROMPT_TEMPLATE).toContain("save_to_file");
  });

  it("mentions the workflow steps", () => {
    expect(GOOGLE_AI_SEARCH_PROMPT_TEMPLATE).toContain("Workflow");
    expect(GOOGLE_AI_SEARCH_PROMPT_TEMPLATE).toContain("search_ai");
  });
});
