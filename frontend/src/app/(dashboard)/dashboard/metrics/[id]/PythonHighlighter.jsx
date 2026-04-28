'use client';

// Minimal Python tokenizer for read-only display. Handles keywords, builtins,
// comments, strings (triple- and single-quoted), numbers, decorators, and
// function-definition names. Zero dependencies — a full-fat highlighter like
// Prism/Shiki would add >30KB for one language on a display-only surface.

const KEYWORDS = new Set([
  'and', 'as', 'assert', 'async', 'await', 'break', 'class', 'continue', 'def',
  'del', 'elif', 'else', 'except', 'finally', 'for', 'from', 'global', 'if',
  'import', 'in', 'is', 'lambda', 'nonlocal', 'not', 'or', 'pass', 'raise',
  'return', 'try', 'while', 'with', 'yield', 'True', 'False', 'None',
]);

const BUILTINS = new Set([
  'abs', 'all', 'any', 'bool', 'bytes', 'dict', 'enumerate', 'filter', 'float',
  'frozenset', 'int', 'isinstance', 'len', 'list', 'map', 'max', 'min', 'open',
  'print', 'range', 'reversed', 'round', 'set', 'sorted', 'str', 'sum', 'tuple',
  'type', 'zip',
]);

const COLORS = {
  keyword: '#e69bff',
  builtin: '#b1d2ff',
  string: '#a8cf84',
  comment: '#7a7574',
  number: '#e9bcb5',
  decorator: '#ffb86c',
  fn: '#ffd866',
  plain: 'inherit',
};

function tokenize(source) {
  const tokens = [];
  let i = 0;
  let expectFnName = false;

  const push = (type, value) => {
    if (!value) return;
    tokens.push({ type, value });
  };

  while (i < source.length) {
    const ch = source[i];

    if (ch === '#') {
      let j = i;
      while (j < source.length && source[j] !== '\n') j++;
      push('comment', source.slice(i, j));
      i = j;
      continue;
    }

    if ((ch === '"' && source.slice(i, i + 3) === '"""') ||
        (ch === "'" && source.slice(i, i + 3) === "'''")) {
      const quote = source.slice(i, i + 3);
      let j = i + 3;
      while (j < source.length && source.slice(j, j + 3) !== quote) j++;
      j = Math.min(source.length, j + 3);
      push('string', source.slice(i, j));
      i = j;
      continue;
    }

    if (ch === '"' || ch === "'") {
      let j = i + 1;
      while (j < source.length && source[j] !== ch && source[j] !== '\n') {
        if (source[j] === '\\') j += 2;
        else j++;
      }
      if (source[j] === ch) j++;
      push('string', source.slice(i, j));
      i = j;
      continue;
    }

    if (ch === '@' && /[A-Za-z_]/.test(source[i + 1] || '')) {
      let j = i + 1;
      while (j < source.length && /[A-Za-z0-9_.]/.test(source[j])) j++;
      push('decorator', source.slice(i, j));
      i = j;
      continue;
    }

    if (/[0-9]/.test(ch)) {
      let j = i;
      while (j < source.length && /[0-9._]/.test(source[j])) j++;
      push('number', source.slice(i, j));
      i = j;
      continue;
    }

    if (/[A-Za-z_]/.test(ch)) {
      let j = i;
      while (j < source.length && /[A-Za-z0-9_]/.test(source[j])) j++;
      const value = source.slice(i, j);
      let type = 'plain';
      if (KEYWORDS.has(value)) type = 'keyword';
      else if (BUILTINS.has(value)) type = 'builtin';
      else if (expectFnName) type = 'fn';
      push(type, value);
      expectFnName = value === 'def' || value === 'class';
      i = j;
      continue;
    }

    let j = i;
    while (
      j < source.length &&
      !/[#"'@0-9A-Za-z_]/.test(source[j])
    ) j++;
    if (j === i) j = i + 1;
    push('plain', source.slice(i, j));
    i = j;
  }
  return tokens;
}

export default function PythonHighlighter({ source }) {
  const tokens = tokenize(source || '');
  return (
    <pre
      className="p-4 text-[0.75rem] overflow-x-auto"
      style={{
        backgroundColor: '#1c1b1b',
        color: '#f6f3f2',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        lineHeight: 1.55,
        whiteSpace: 'pre',
        borderRadius: 0,
        margin: 0,
      }}
    >
      <code>
        {tokens.map((t, idx) => (
          <span key={idx} style={{ color: COLORS[t.type] || COLORS.plain }}>
            {t.value}
          </span>
        ))}
      </code>
    </pre>
  );
}
