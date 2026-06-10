import { basename, dirname } from "#std/path";

const RED = "\x1b[31m";
const RESET = "\x1b[0m";

const INSTALL_SH =
  "https://raw.githubusercontent.com/mrg-keystone/rune/main/scripts/install.sh";

// `rune update [tag]` (alias: upgrade) — self-update. Fetches install.sh from
// GitHub and runs it: the installer uninstalls every prior copy, installs the
// rolling `latest` release (or the pinned tag, e.g. v0.1.0), and refreshes the
// Claude Code skill in user scope. Exit code is the installer's.

export interface UpdatePlan {
  error?: string;
  tag?: string; // RUNE_VERSION for the installer (unset = latest)
  bindir?: string; // RUNE_INSTALL for the installer (unset = its default)
}

// Pure planning: validate args and decide the installer's env. Split out so the
// decision logic is testable without network/process side effects.
export function planUpdate(
  args: string[],
  runtime: {
    os: string;
    execPath: string;
    env: Record<string, string | undefined>;
  },
): UpdatePlan {
  if (runtime.os === "windows") {
    return { error: "no prebuilt release exists for Windows." };
  }
  const flag = args.find((a) => a.startsWith("--"));
  if (flag) return { error: `unknown option '${flag}' — usage: rune update [tag]` };
  const positional = args.filter((a) => !a.startsWith("--"));
  if (positional.length > 1) {
    return { error: "too many arguments — usage: rune update [tag]" };
  }

  const plan: UpdatePlan = {};
  if (positional[0]) plan.tag = positional[0];

  // Install over the running binary's own directory, so update replaces the
  // copy that was invoked wherever it lives. An explicit RUNE_INSTALL wins;
  // under `deno run` (dev) the exec path is deno itself, so fall through to
  // the installer's default.
  if (!runtime.env.RUNE_INSTALL && basename(runtime.execPath) === "rune") {
    plan.bindir = dirname(runtime.execPath);
  }
  return plan;
}

export async function runUpdate(args: string[]): Promise<number> {
  const plan = planUpdate(args, {
    os: Deno.build.os,
    execPath: Deno.execPath(),
    env: { RUNE_INSTALL: Deno.env.get("RUNE_INSTALL") },
  });
  if (plan.error) {
    console.error(`${RED}rune: ${plan.error}${RESET}`);
    return 2;
  }

  let script: string;
  try {
    const res = await fetch(INSTALL_SH);
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    script = await res.text();
  } catch (e) {
    console.error(
      `${RED}rune: cannot fetch the installer: ${
        e instanceof Error ? e.message : e
      }${RESET}`,
    );
    return 2;
  }

  const tmp = await Deno.makeTempFile({
    prefix: "rune-install-",
    suffix: ".sh",
  });
  try {
    await Deno.writeTextFile(tmp, script);
    const env: Record<string, string> = {};
    if (plan.tag) env.RUNE_VERSION = plan.tag;
    if (plan.bindir) env.RUNE_INSTALL = plan.bindir;
    const child = new Deno.Command("sh", {
      args: [tmp],
      env,
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    }).spawn();
    return (await child.status).code;
  } finally {
    await Deno.remove(tmp).catch(() => {});
  }
}
