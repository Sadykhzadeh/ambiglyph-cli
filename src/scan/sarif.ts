import { readFileSync } from 'fs';
import type { Finding, Rule } from '../engine/detect.js';

const RULES: Record<Rule, string> = {
  'mixed-script': 'A word mixes scripts, and a letter of the minority script passes for one of the majority.',
  'confusable': 'A word holds a compatibility, mathematical or ligature form that Unicode restricts in identifiers.',
  'invisible': 'A zero-width, filler, bidi control or tag character that is not visible in the text.',
};

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
            artifactLocation: { uri: f.file.split(/[\\/]/).map(encodeURIComponent).join('/'), uriBaseId: '%SRCROOT%' },
            region: { startLine: f.line, startColumn: f.column },
          },
        }],
      })),
    }],
  }, null, 2) + '\n';
}
