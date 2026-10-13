import { readFileSync } from 'fs';
import { relative, resolve } from 'path';
import type { Finding, Rule } from '../engine/detect.js';

const RULES: Record<Rule, string> = {
  'mixed-script': 'A word mixes scripts, and a letter of the minority script passes for one of the majority; or a word in another script, joined to Latin text, passes for Latin.',
  'confusable': 'A word holds a compatibility, mathematical or ligature form that Unicode restricts in identifiers.',
  'invisible': 'A zero-width, filler, bidi control, tag character, extra variation selector or other mark that is not visible in the text.',
};

// The file's URI against %SRCROOT%, which is the working directory however
// the file was named: an absolute path there would not resolve against it.
const uri = (file: string): string => (file === '<stdin>' ? file : relative(process.cwd(), resolve(file)))
  .split(/[\\/]/).map(encodeURIComponent).join('/');

// A SARIF 2.1.0 log, the format GitHub code scanning and most CI dashboards
// read. Columns are UTF-16 code units, which is SARIF's default.
export function sarif(findings: Array<Finding & { file: string }>): string {
  const { version } = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8'));
  const ids = Object.keys(RULES) as Rule[];
  return JSON.stringify({
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    version: '2.1.0',
    runs: [{
      tool: {
        driver: {
          name: 'ambiglyph',
          version,
          rules: ids.map(id => ({ id, shortDescription: { text: RULES[id] } })),
        },
      },
      results: findings.map(f => ({
        ruleId: f.rule,
        ruleIndex: ids.indexOf(f.rule),
        level: 'warning',
        message: { text: f.suggestion === undefined ? f.message : `${f.message} -> ${f.suggestion || '(remove it)'}` },
        locations: [{
          physicalLocation: {
            artifactLocation: { uri: uri(f.file), uriBaseId: '%SRCROOT%' },
            region: { startLine: f.line, startColumn: f.column },
          },
        }],
      })),
    }],
  }, null, 2) + '\n';
}
