// Compiles the C# game engine (game/Web -> game/Engine) to WebAssembly and
// copies the runtime into public/game/engine/_framework.
//
// The output is committed, so deploys (Cloudflare, Vercel, any static host)
// never need the .NET SDK. Re-run after changing anything under game/:
//   npm run game:build
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const project = join(root, 'game', 'Web', 'Web.csproj');
const target = join(root, 'public', 'game', 'engine', '_framework');
const out = mkdtempSync(join(tmpdir(), 'crimson-arena-'));

try {
  execFileSync('dotnet', ['--version'], { stdio: 'ignore' });
} catch {
  console.error('The .NET 10 SDK is required to rebuild the game engine: https://dot.net/download');
  process.exit(1);
}

try {
  execFileSync('dotnet', ['publish', project, '-c', 'Release', '-o', out, '--nologo'], { stdio: 'inherit' });
  const framework = join(out, 'wwwroot', '_framework');
  if (!existsSync(join(framework, 'dotnet.js'))) throw new Error(`publish produced no ${framework}/dotnet.js`);

  rmSync(target, { recursive: true, force: true });
  cpSync(framework, target, { recursive: true });

  let total = 0;
  for (const file of readdirSync(target)) {
    const size = statSync(join(target, file)).size;
    total += size;
    console.log(`  ${file.padEnd(58)} ${(size / 1024).toFixed(1).padStart(8)} KB`);
  }
  console.log(`Game engine -> public/game/engine/_framework (${(total / 1024 / 1024).toFixed(2)} MB)`);
} finally {
  rmSync(out, { recursive: true, force: true });
}
