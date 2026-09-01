import { describe, expect, test } from "bun:test";
import { filePathHtml, filePathTitle, middleElidePath, pathHtml } from "./path.ts";

const within=(width: number)=>(text: string)=>Array.from(text).length<=width;

describe("middleElidePath", () => {
  test("leaves a path alone while it fits", () => {
    expect(middleElidePath("start/folder/filename.txt",within(40))).toBe("start/folder/filename.txt");
  });

  test("removes only one middle run and keeps the complete file name", () => {
    const shown=middleElidePath("start/123456789/also/filename.txt",within(24));
    expect(shown).toBe("start…/also/filename.txt");
    expect(shown.endsWith("/filename.txt")).toBe(true);
    expect(shown.match(/…/g)).toHaveLength(1);
  });

  test("keeps the beginning and file name at the narrowest useful width", () => {
    expect(middleElidePath("start/123456789/also/filename.txt",within(5))).toBe("s…/filename.txt");
  });

  test("does not manufacture a longer label for a shallow path", () => {
    expect(middleElidePath("a/file.txt",within(4))).toBe("a/file.txt");
    expect(middleElidePath("README.md",within(4))).toBe("README.md");
  });
});

describe("pathHtml", () => {
  test("one measured label owns the whole path", () => {
    expect(pathHtml("apps/web/components/Panel.tsx")).toBe(
      '<span class="pth" data-path="apps/web/components/Panel.tsx">'+
      '<span class="ptx">apps/web/components/Panel.tsx</span></span>',
    );
  });

  test("a path with no folder is the name alone", () => {
    expect(pathHtml("README.md")).toContain('<span class="ptx">README.md</span>');
  });

  test("a path is escaped like anything else drawn into the page", () => {
    expect(pathHtml('src/<img>&"/x".ts')).toBe(
      '<span class="pth" data-path="src/&lt;img&gt;&amp;&quot;/x&quot;.ts">'+
      '<span class="ptx">src/&lt;img&gt;&amp;&quot;/x&quot;.ts</span></span>',
    );
  });

  test("escapes an optional title and uses only known presentation classes", () => {
    expect(pathHtml('old/"name".ts',{className:'was',title:'old/"name".ts'})).toBe(
      '<span class="pth was" title="old/&quot;name&quot;.ts" data-path="old/&quot;name&quot;.ts">'+
      '<span class="ptx">old/&quot;name&quot;.ts</span></span>',
    );
  });
});

describe("filePathHtml", () => {
  test("a rename shows both its old and new paths", () => {
    const file={from:"src/old-name.ts",path:"src/new-name.ts"};
    expect(filePathHtml(file)).toBe(
      '<span class="pth from" data-path="src/old-name.ts"><span class="ptx">src/old-name.ts</span></span>'+
      '<span class="arrow">→</span><span class="pth to" data-path="src/new-name.ts">'+
      '<span class="ptx">src/new-name.ts</span></span>',
    );
    expect(filePathTitle(file)).toBe("src/old-name.ts → src/new-name.ts");
  });

  test("an ordinary file shows one path", () => {
    const file={path:"src/app.ts"};
    expect(filePathHtml(file)).toBe(
      '<span class="pth" data-path="src/app.ts"><span class="ptx">src/app.ts</span></span>',
    );
    expect(filePathTitle(file)).toBe("src/app.ts");
  });
});
