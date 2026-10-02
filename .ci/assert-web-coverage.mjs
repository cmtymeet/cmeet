import { readFileSync, readdirSync } from 'node:fs';
import { resolve, relative } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const report = JSON.parse(readFileSync(resolve(root, 'apps/web/coverage/coverage-final.json'), 'utf8'));
const covered = new Set(Object.keys(report).map(path => relative(root, path).replaceAll('\\', '/')));
const required = [
  'core/src/dev-adapter.ts',
  'ui/src/member-name.ts',
  'ui/src/i18n/en.ts',
  ...readdirSync(resolve(root, 'ui/src/components')).filter(name => name.endsWith('.svelte')).map(name => `ui/src/components/${name}`),
];
for (const path of required) {
  if (!covered.has(path)) throw new Error(`Coverage omitted executable source: ${path}`);
}
const summary = JSON.parse(readFileSync(resolve(root, 'apps/web/coverage/coverage-summary.json'), 'utf8')).total;
for (const metric of ['statements', 'branches', 'functions', 'lines']) {
  if (!(summary[metric].total > 0) || summary[metric].pct !== 100) {
    throw new Error(`Web ${metric} coverage must be nonempty and 100%: ${JSON.stringify(summary[metric])}`);
  }
}
console.log('Every shared component, presentation helper and development adapter is covered.');
