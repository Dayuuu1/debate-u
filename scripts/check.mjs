import { spawnSync } from "node:child_process";
import { readdir, readFile, access } from "node:fs/promises";
for (const dir of ["public", "lib", "api", "scripts"])
  for (const file of await readdir(dir)) {
    if (/\.m?js$/.test(file)) {
      const result = spawnSync(
        process.execPath,
        ["--check", `${dir}/${file}`],
        { stdio: "inherit" },
      );
      if (result.status !== 0) process.exit(result.status || 1);
    }
  }
for (const file of await readdir("public")) {
  if (!/\.(css|html|js)$/.test(file)) continue;
  const text = await readFile(`public/${file}`, "utf8");
  for (const match of text.matchAll(
    /(?:src=["']|href=["']|url\(["']?)(assets\/[^"')]+)/g,
  ))
    await access("public/" + match[1]);
}
console.log(
  "Build verificado: JavaScript y recursos estáticos. Vercel sirve public/ y api/.",
);
