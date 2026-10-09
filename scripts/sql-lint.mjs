#!/usr/bin/env node
// Structural SQL linter.
// Finds the two failure modes that made the hand-pasted batches un-runnable:
//   1. orphaned / unclosed dollar-quoted bodies  ($$ ... EOF, odd tag count)
//   2. truncated statements spliced into the next one, i.e. a statement opener
//      (CREATE/DROP/UPDATE/...) that directly follows a trailing comma.
// No dependencies. Usage: node scripts/sql-lint.mjs [files...]
import { readFileSync } from 'node:fs';
import { globSync } from 'node:fs';
import { relative, resolve } from 'node:path';

const OPENERS = /^(CREATE|DROP|ALTER|DO|NOTIFY|INSERT|UPDATE|DELETE|GRANT|REVOKE|TRUNCATE|COMMENT)\b/i;

function lint(path) {
  const src = readFileSync(path, 'utf8');
  const errs = [];
  let i = 0, line = 1, lineStart = 0;
  let depth = 0, minDepth = 0;
  let dollar = null, dollarLine = 0;
  let str = false, ident = false, lineC = false, blk = 0, inGrant = false;
  let prevSig = '', prevLine = 0;

  const at = (n = i) => src.slice(n, n + 40).replace(/\r?\n/g, '\\n');
  const wordAt = (n) => { const m = /^([A-Za-z_][A-Za-z0-9_]*)/.exec(src.slice(n)); return m ? m[1] : ''; };

  while (i < src.length) {
    const ch = src[i], nx = src[i + 1];
    if (ch === '\n') { line++; lineC = false; lineStart = i + 1; i++; continue; }
    if (lineC) { i++; continue; }
    if (blk) {
      if (ch === '*' && nx === '/') { blk--; i += 2; continue; }
      if (ch === '/' && nx === '*') { blk++; i += 2; continue; }
      i++; continue;
    }
    if (dollar) {
      if (ch === '$' && src.startsWith(dollar, i)) {
        if (process.env.SQL_LINT_TRACE) console.log(`  close ${dollar} @${line} (opened ${dollarLine})`);
        i += dollar.length; dollar = null; continue;
      }
      i++; continue;
    }
    if (str) {
      if (ch === "'") { if (nx === "'") { i += 2; continue; } str = false; }
      i++; continue;
    }
    if (ident) { if (ch === '"') { if (nx === '"') { i += 2; continue; } ident = false; } i++; continue; }

    if (ch === '-' && nx === '-') { lineC = true; i += 2; continue; }
    if (ch === '/' && nx === '*') { blk = 1; i += 2; continue; }
    if (ch === "'") { str = true; prevSig = ch; i++; continue; }
    if (ch === '"') { ident = true; i++; continue; }
    if (ch === '$') {
      const m = /^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/.exec(src.slice(i));
      if (m) {
        if (dollar) { if (process.env.SQL_LINT_TRACE) console.log(`  close ${m[0]} @${line} (opened ${dollarLine})`); dollar = null; }
        else { dollar = m[0]; dollarLine = line; if (process.env.SQL_LINT_TRACE) console.log(`  open  ${m[0]} @${line}`); }
        i += m[0].length; continue;
      }
    }
    if (ch === '(') { depth++; i++; continue; }
    if (ch === ')') { depth--; if (depth < minDepth) minDepth = depth; i++; continue; }
    if (ch === ';') { inGrant = false; prevSig = ch; prevLine = line; i++; continue; }

    if (/[A-Za-z_]/.test(ch)) {
      const w = wordAt(i);
      const col0 = i === lineStart;
      if (/^(GRANT|REVOKE)$/i.test(w)) inGrant = true;

      if (dollar) {
        // A DDL keyword starting a new line right after ';' or ',' inside a
        // dollar-quoted body means the body was cut short and the next
        // statement was spliced into it.
        if (col0 && (prevSig === ';' || prevSig === ',') && /^(CREATE|DROP|ALTER)$/i.test(w)) {
          errs.push(`${path}:${line}  SPLICE: '${w}' inside dollar-quote opened at line ${dollarLine}  ~ ${at()}`);
        }
      } else {
        if (!inGrant && prevSig === ',' && OPENERS.test(w)) {
          errs.push(`${path}:${line}  TRUNCATED: '${w}' spliced after trailing comma at line ${prevLine}  ~ ${at()}`);
        } else if (!inGrant && depth === 0 && col0 && prevSig !== ';' && prevSig !== '' && prevSig !== ')' && OPENERS.test(w)) {
          // Statements start at column 0 and must be ';' terminated by the time
          // the next column-0 statement begins. A preceding ')' is excluded
          // because `WITH cte AS ( ... ) INSERT ...` continues after the CTE.
          errs.push(`${path}:${line}  UNTERMINATED: no ';' before '${w}' opened at line ${prevLine}  ~ ${at()}`);
        }
      }

      i += w.length;
      prevSig = 'w'; prevLine = line;
      continue;
    }
    if (!/\s/.test(ch)) { prevSig = ch; prevLine = line; }
    i++;
  }

  if (dollar) errs.push(`${path}:${dollarLine}  UNCLOSED dollar-quote ${dollar} (never closed before EOF)`);
  if (str) errs.push(`${path}  UNCLOSED single-quoted string at EOF`);
  if (blk) errs.push(`${path}  UNCLOSED block comment at EOF`);
  if (depth !== 0) errs.push(`${path}  UNBALANCED parens at EOF (depth ${depth}, min ${minDepth})`);
  return errs;
}


// ---- driver ---------------------------------------------------------------
const argv = process.argv.slice(2);
let files = argv;
if (files.length === 0) {
  files = globSync('supabase/migrations/*.sql')
    .concat(globSync('supabase/*.sql'))
    .concat(globSync('*.sql'))
    .concat(globSync('scripts/*.sql'));
}
files = [...new Set(files.map(f => resolve(f)))];

let total = 0;
for (const f of files.sort()) {
  const errs = lint(f);
  total += errs.length;
  if (errs.length) { console.log(`\n${relative(process.cwd(), f)}`); errs.forEach(e => console.log('   ' + e)); }
}

console.log(`\nscanned ${files.length} sql file(s), ${total} structural problem(s)`);
process.exit(total ? 1 : 0);
