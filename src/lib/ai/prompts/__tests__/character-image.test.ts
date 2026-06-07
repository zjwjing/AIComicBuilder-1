import { describe, it, expect } from "vitest";
import { characterImageHiDreamO1Def, characterImageIdeogram4Def, characterImageSimpleDef } from "../registry-character";

describe("characterImageHiDreamO1Def", () => {
  it("builds prompt with character name and description", () => {
    const result = characterImageHiDreamO1Def.buildFullPrompt({}, {
      characterName: "Hero",
      description: "Tall muscular warrior with a broadsword",
    });
    expect(result).toContain("Hero");
    expect(result).toContain("Tall muscular warrior with a broadsword");
    expect(result).toContain("four-view");
    expect(result).toContain("turnaround");
    expect(result).toContain("2x2 grid");
  });

  it("handles empty params gracefully", () => {
    const result = characterImageHiDreamO1Def.buildFullPrompt({}, {});
    expect(result).not.toContain("undefined");
    expect(result).toContain("four-view");
  });

  it("includes pure white background instruction", () => {
    const result = characterImageHiDreamO1Def.buildFullPrompt({}, {
      characterName: "Test",
      description: "Test description",
    });
    expect(result).toContain("pure white background");
  });

  it("describes all four views", () => {
    const result = characterImageHiDreamO1Def.buildFullPrompt({}, {
      characterName: "A",
      description: "B",
    });
    expect(result).toContain("Front view");
    expect(result).toContain("Back view");
    expect(result).toContain("Side profile");
    expect(result).toContain("Three-quarter view");
  });
});

describe("characterImageIdeogram4Def", () => {
  it("returns JSON string with character info", () => {
    const result = characterImageIdeogram4Def.buildFullPrompt({}, {
      characterName: "Hero",
      description: "A tall warrior",
    });
    const parsed = JSON.parse(result);
    expect(parsed.high_level_description).toContain("Hero");
    expect(parsed.high_level_description).toContain("turnaround sheet");
    expect(parsed.style_description.aesthetics).toContain("Disney-Pixar");
  });

  it("strips Chinese characters from description", () => {
    const result = characterImageIdeogram4Def.buildFullPrompt({}, {
      characterName: "英雄",
      description: "一个高大的战士，身穿铠甲",
    });
    const parsed = JSON.parse(result);
    expect(parsed.high_level_description).not.toContain("一个高大的战士");
    expect(parsed.compositional_deconstruction.elements[0].desc).not.toContain("一个高大的战士");
  });

  it("keeps English description when no Chinese", () => {
    const result = characterImageIdeogram4Def.buildFullPrompt({}, {
      characterName: "Hero",
      description: "Tall warrior in armor",
    });
    const parsed = JSON.parse(result);
    expect(parsed.high_level_description).toContain("Tall warrior in armor");
  });

  it("has exactly 4 elements in compositional_deconstruction", () => {
    const result = characterImageIdeogram4Def.buildFullPrompt({}, {
      characterName: "Hero",
      description: "Warrior",
    });
    const parsed = JSON.parse(result);
    expect(parsed.compositional_deconstruction.elements).toHaveLength(4);
  });

  it("uses 1000x1000 canvas pixel bbox", () => {
    const result = characterImageIdeogram4Def.buildFullPrompt({}, {
      characterName: "Hero",
      description: "Warrior",
    });
    const parsed = JSON.parse(result);
    const elements = parsed.compositional_deconstruction.elements;
    for (const el of elements) {
      expect(el.bbox[0]).toBeGreaterThanOrEqual(0);
      expect(el.bbox[1]).toBeGreaterThanOrEqual(0);
      expect(el.bbox[2]).toBeLessThanOrEqual(1000);
      expect(el.bbox[3]).toBeLessThanOrEqual(1000);
    }
  });
});

describe("characterImageSimpleDef", () => {
  it("builds prompt with style from slot and character info", () => {
    const sc = {
      style_and_format: "3D Disney style, white background",
    };
    const result = characterImageSimpleDef.buildFullPrompt(sc, {
      characterName: "Mario",
      description: "Plumber with red hat",
    });
    expect(result).toContain("3D Disney style, white background");
    expect(result).toContain("Mario");
    expect(result).toContain("Plumber with red hat");
  });

  it("uses default slot style when sc is empty", () => {
    const sc = { style_and_format: "3D迪士尼动画风格，皮克斯式渲染，角色全身立绘，纯白背景，角色居中站立，不要出现任何文字标签。" };
    const result = characterImageSimpleDef.buildFullPrompt(sc, {
      characterName: "Test",
    });
    expect(result).toContain("皮克斯式渲染");
  });
});
