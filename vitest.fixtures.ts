// P4-T03: fixture-dependent tests fail (not skip) in CI when samples/, tests/fixtures/ or
// TEST_DATABASE_URL are missing; locally they are skipped with a warning. Every package's
// vitest.config.ts calls `guardFixtures`.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

/** Fixture directories, relative to the repository root. */
export const FIXTURE_DIRS = ["samples", "tests/fixtures"] as const;

export interface FixtureGuardInput {
  ci: boolean;
  needsDatabase: boolean;
  databaseUrl: string | undefined;
  /** FIXTURE_DIRS entries that do not exist. */
  missingDirs: string[];
  /** Test files of the package (path relative to the package, content). */
  testFiles: { file: string; content: string }[];
}

export interface FixtureGuardResult {
  /** Test files to leave out (locally only): those that read a missing fixture directory. */
  exclude: string[];
  warnings: string[];
}

// A path that names the directory: `…/samples/x` or `"…/samples"`.
const mentions = (content: string, dir: string) => new RegExp(`(^|[^\\w-])${dir.replace("/", "\\/")}(\\/|["'\`])`).test(content);

export function fixtureGuard({ ci, needsDatabase, databaseUrl, missingDirs, testFiles }: FixtureGuardInput): FixtureGuardResult {
  const missingDb = needsDatabase && !databaseUrl;
  if (ci && (missingDb || missingDirs.length)) {
    const what = [...(missingDb ? ["TEST_DATABASE_URL"] : []), ...missingDirs.map((d) => `${d}/`)].join(", ");
    throw new Error(`CI=true but ${what} missing: fixture-dependent tests must run in CI, not be skipped (P4-T03)`);
  }
  const warnings: string[] = [];
  if (missingDb) warnings.push("TEST_DATABASE_URL is not set: database tests are skipped");
  const exclude: string[] = [];
  for (const dir of missingDirs) {
    const hit = testFiles.filter((f) => mentions(f.content, dir)).map((f) => f.file);
    exclude.push(...hit);
    warnings.push(`${dir}/ is missing: ${hit.length} test file(s) that read it are skipped`);
  }
  return { exclude: [...new Set(exclude)], warnings };
}

const withoutComments = (code: string) => code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

/** The code of `file` plus every module it reaches through relative imports, comments removed. */
function codeWithLocalImports(entry: string): string {
  const seen = new Set<string>();
  const parts: string[] = [];
  const visit = (file: string) => {
    if (seen.has(file) || !existsSync(file)) return;
    seen.add(file);
    const code = withoutComments(readFileSync(file, "utf8"));
    parts.push(code);
    for (const [, spec] of code.matchAll(/(?:from|import)\s*\(?\s*["'](\.{1,2}\/[^"']+)["']/g)) {
      const base = resolve(dirname(file), spec!);
      const hit = [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts")].find((p) => existsSync(p) && statSync(p).isFile());
      if (hit) visit(hit);
    }
  };
  visit(entry);
  return parts.join("\n");
}

/** Test files of a package with the code they reach through relative imports. */
export function testFilesOf(packageDir: string): { file: string; content: string }[] {
  return (readdirSync(packageDir, { recursive: true }) as string[])
    .map((f) => f.replace(/\\/g, "/"))
    .filter((f) => /\.test\.tsx?$/.test(f) && !/(^|\/)(node_modules|\.next[^/]*)\//.test(f))
    .map((file) => ({ file, content: codeWithLocalImports(join(packageDir, file)) }));
}

/** For vitest.config.ts: throws in CI when fixtures are missing; locally prints warnings and returns files to exclude. */
export function guardFixtures(opts: {
  root: string;
  packageDir: string;
  needsDatabase: boolean;
  env: Record<string, string | undefined>;
}): string[] {
  const { exclude, warnings } = fixtureGuard({
    ci: opts.env.CI === "true" || process.env.CI === "true",
    needsDatabase: opts.needsDatabase,
    databaseUrl: opts.env.TEST_DATABASE_URL,
    missingDirs: FIXTURE_DIRS.filter((d) => !existsSync(join(opts.root, d))),
    testFiles: testFilesOf(opts.packageDir),
  });
  for (const w of warnings) console.warn(`[fixtures] ${relative(opts.root, opts.packageDir) || "."}: ${w}`);
  return exclude;
}
