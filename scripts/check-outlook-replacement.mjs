import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const scanRoots = ['src', 'supabase/functions', 'supabase/config.toml', 'scripts'];
const excluded = new Set([
  path.join(root, 'src/integrations/supabase/types.ts'),
  path.join(root, 'scripts/check-outlook-replacement.mjs'),
]);

const blocked = [
  /microsoft_config/g,
  /get_microsoft_token/g,
  /microsoft-auth/g,
  /microsoft-callback/g,
  /microsoft-api/g,
  /useMicrosoftApi/g,
  /useMicrosoftConfig/g,
  /MicrosoftSettings/g,
  /MicrosoftAccountPicker/g,
  /\bsendViaOutlook\b/g,
];

const fileExt = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.toml']);

function walk(target, files = []) {
  const abs = path.join(root, target);
  if (!fs.existsSync(abs)) return files;
  const stat = fs.statSync(abs);
  if (stat.isFile()) {
    if (fileExt.has(path.extname(abs))) files.push(abs);
    return files;
  }
  for (const entry of fs.readdirSync(abs)) {
    if (entry === 'node_modules' || entry === '.git') continue;
    walk(path.relative(root, path.join(abs, entry)), files);
  }
  return files;
}

const findings = [];
for (const file of scanRoots.flatMap((entry) => walk(entry))) {
  if (excluded.has(file)) continue;
  const text = fs.readFileSync(file, 'utf8');
  const lines = text.split(/\r?\n/);
  for (const regex of blocked) {
    regex.lastIndex = 0;
    let match;
    while ((match = regex.exec(text))) {
      const line = text.slice(0, match.index).split(/\r?\n/).length;
      findings.push(`${path.relative(root, file)}:${line}: ${match[0]}`);
    }
  }
}

if (findings.length > 0) {
  console.error('Oude Outlook/Microsoft-koppeling gevonden in actieve source:');
  for (const finding of findings) console.error(`- ${finding}`);
  process.exit(1);
}

console.log('Outlook replacement check OK');
