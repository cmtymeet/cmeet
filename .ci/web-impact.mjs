// Required check contexts always report; expensive validation follows changed code.
// Workflow infrastructure is validated separately from backend product acceptance.
import { readFileSync, appendFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export function classifyChangedFiles(files) {
  if (!Array.isArray(files) || files.some(file => typeof file !== 'string' || !file || file.includes('\0'))) {
    throw new Error('Invalid changed-path input');
  }
  let web = false;
  let cli = false;
  for (const file of files) {
    if (/^(apps\/web\/|ui\/|core\/|\.ci\/assert-(asset-closure|web-coverage)\.mjs$)/.test(file)) web = true;
    else if (/^(apps\/cli\/|tests\/toy\/|\.ci\/policy\/)/.test(file)) cli = true;
    else if (/^(\.github\/workflows\/(web|ci|dependabot-auto-merge)\.yml|\.ci\/web-impact\.(mjs|test\.mjs))$/.test(file)) web = true;
    else if (/^(docs\/|research\/|README\.md$|LICENSE[^/]*$|\.gitignore$)/.test(file)) continue;
    else { web = true; cli = true; } // Unknown impact: validate both products.
  }
  return { web, cli };
}

export function revisionRange(eventName, event, sha) {
  const valid = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
  if (eventName === 'workflow_dispatch') return null;
  if (eventName === 'pull_request') {
    const base = event.pull_request?.base?.sha;
    const head = event.pull_request?.head?.sha;
    if (!valid(base) || !valid(head)) throw new Error('Missing pull request revisions');
    return `${base}...${head}`;
  }
  if (eventName === 'push') {
    if (!valid(event.before) || !valid(sha)) throw new Error('Missing push revisions');
    if (/^0+$/.test(event.before)) return null;
    return `${event.before}..${sha}`;
  }
  throw new Error('Unsupported workflow event');
}

export function decodePaths(data) {
  if (!Buffer.isBuffer(data)) throw new Error('Expected binary git path output');
  if (!data.length) return [];
  if (data[data.length - 1] !== 0) throw new Error('Truncated git path output');
  return data.toString('utf8').slice(0, -1).split('\0');
}

export function main(env = process.env) {
  const event = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, 'utf8'));
  const range = revisionRange(env.GITHUB_EVENT_NAME, event, env.GITHUB_SHA);
  const result = range === null ? { web: true, cli: true } : classifyChangedFiles(decodePaths(
    execFileSync('git', ['diff', '--no-renames', '--name-only', '-z', range], { maxBuffer: 16 * 1024 * 1024 }),
  ));
  appendFileSync(env.GITHUB_OUTPUT, `web=${result.web}\ncli=${result.cli}\n`);
  process.stdout.write(`Validation applicability: web=${result.web}, cli=${result.cli}\n`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
