import { Fragment, type ReactNode } from 'react';

// A small Markdown subset for the memo: headings, paragraphs, bold, italics, inline code,
// lists, tables, quotes, rules and links. It only ever builds React elements, so HTML in
// the text stays visible text and is never parsed. No dangerouslySetInnerHTML.

type Align = 'left' | 'center' | 'right' | undefined;
type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;

export type Block =
  | { type: 'heading'; level: HeadingLevel; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'list'; ordered: boolean; start: number; items: string[] }
  | { type: 'table'; header: string[]; align: Align[]; rows: string[][] }
  | { type: 'quote'; blocks: Block[] }
  | { type: 'code'; text: string }
  | { type: 'rule' };

const HEADING = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const RULE = /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/;
const BULLET = /^\s*[-*+]\s+(.*)$/;
const NUMBERED = /^\s*(\d+)[.)]\s+(.*)$/;
const QUOTE = /^\s{0,3}>\s?(.*)$/;
const FENCE = /^\s{0,3}```/;
const TABLE_DIVIDER = /^\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?\s*$/;

function splitRow(line: string): string[] {
  let row = line.trim();
  if (row.startsWith('|')) row = row.slice(1);
  if (row.endsWith('|') && !row.endsWith('\\|')) row = row.slice(0, -1);

  const cells: string[] = [];
  let cell = '';
  for (let i = 0; i < row.length; i += 1) {
    if (row[i] === '\\' && row[i + 1] === '|') {
      cell += '\\|'; // Stays escaped here, renderInline turns it back into a pipe.
      i += 1;
    } else if (row[i] === '|') {
      cells.push(cell.trim());
      cell = '';
    } else {
      cell += row[i];
    }
  }
  cells.push(cell.trim());
  return cells;
}

const isTableStart = (line: string, next: string | undefined) =>
  line.includes('|') && next !== undefined && next.includes('-') && TABLE_DIVIDER.test(next)
  && splitRow(line).length === splitRow(next).length;

const startsBlock = (line: string, next: string | undefined) =>
  !line.trim() || HEADING.test(line) || RULE.test(line) || BULLET.test(line) || NUMBERED.test(line)
  || QUOTE.test(line) || FENCE.test(line) || isTableStart(line, next);

function columnAlign(divider: string): Align {
  const left = divider.startsWith(':');
  const right = divider.endsWith(':');
  if (left && right) return 'center';
  if (right) return 'right';
  return left ? 'left' : undefined;
}

export function parseBlocks(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i += 1;
      continue;
    }

    if (FENCE.test(line)) {
      const code: string[] = [];
      i += 1;
      while (i < lines.length && !FENCE.test(lines[i])) {
        code.push(lines[i]);
        i += 1;
      }
      i += 1;
      blocks.push({ type: 'code', text: code.join('\n') });
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      blocks.push({ type: 'heading', level: heading[1].length as HeadingLevel, text: heading[2] });
      i += 1;
      continue;
    }

    if (isTableStart(line, lines[i + 1])) {
      const header = splitRow(line);
      const align = splitRow(lines[i + 1]).map(columnAlign);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i].trim() && lines[i].includes('|')) {
        const cells = splitRow(lines[i]);
        rows.push(header.map((_, column) => cells[column] ?? ''));
        i += 1;
      }
      blocks.push({ type: 'table', header, align, rows });
      continue;
    }

    if (RULE.test(line)) {
      blocks.push({ type: 'rule' });
      i += 1;
      continue;
    }

    if (QUOTE.test(line)) {
      const quoted: string[] = [];
      while (i < lines.length && QUOTE.test(lines[i])) {
        quoted.push(lines[i].replace(QUOTE, '$1'));
        i += 1;
      }
      blocks.push({ type: 'quote', blocks: parseBlocks(quoted.join('\n')) });
      continue;
    }

    const ordered = NUMBERED.test(line);
    if (ordered || BULLET.test(line)) {
      const marker = ordered ? NUMBERED : BULLET;
      const otherMarker = ordered ? BULLET : NUMBERED;
      const items: string[] = [];
      const start = ordered ? Number(NUMBERED.exec(line)?.[1]) : 1;

      while (i < lines.length) {
        const current = lines[i];
        // Nested items are flattened into the list: a memo does not need deeper levels.
        const item = marker.exec(current) ?? (/^\s/.test(current) ? otherMarker.exec(current) : null);
        if (item) {
          items.push(item[item.length - 1]);
          i += 1;
        } else if (!current.trim()) {
          let next = i;
          while (next < lines.length && !lines[next].trim()) next += 1;
          if (next >= lines.length || !marker.test(lines[next])) break;
          i = next;
        } else if (!startsBlock(current, lines[i + 1])) {
          items[items.length - 1] += ` ${current.trim()}`;
          i += 1;
        } else {
          break;
        }
      }
      blocks.push({ type: 'list', ordered, start, items });
      continue;
    }

    const paragraph = [line];
    i += 1;
    while (i < lines.length && !startsBlock(lines[i], lines[i + 1])) {
      paragraph.push(lines[i]);
      i += 1;
    }
    blocks.push({ type: 'paragraph', text: paragraph.join('\n') });
  }
  return blocks;
}

/** Only these schemes become links. Everything else, javascript: included, stays plain text. */
export function safeHref(url: string): string | null {
  try {
    const { href, protocol } = new URL(url);
    return ['http:', 'https:', 'mailto:'].includes(protocol) ? href : null;
  } catch {
    return null;
  }
}

const INLINE = new RegExp([
  /\\([\\`*_{}[\]()#+\-.!|>~])/.source, // 1: backslash escape
  /`([^`\n]+)`/.source, // 2: inline code
  /\*\*(\S(?:[\s\S]*?\S)?)\*\*/.source, // 3: bold
  /\*([^\s*](?:[^*]*[^\s*])?)\*/.source, // 4: italics, so "3 * 4 * 5" stays as it is
  /\[([^\]]*)\]\(\s*([^\s()]*(?:\([^\s()]*\)[^\s()]*)*)(?:\s+"[^"]*")?\s*\)/.source, // 5, 6: link
  /(https?:\/\/[^\s<>]*[^\s<>.,;:!?)\]])/.source, // 7: bare address
].join('|'), 'g');

const LINE_BREAK = /(?: {2,}|\\)\n/;

function renderLink(key: number, label: ReactNode, url: string): ReactNode {
  const href = safeHref(url);
  if (!href) return <span key={key}>{label}</span>;
  return <a key={key} href={href} target="_blank" rel="noopener noreferrer">{label}</a>;
}

export function renderInline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let position = 0;

  for (const match of text.matchAll(INLINE)) {
    const index = match.index ?? 0;
    const [whole, escaped, code, bold, italics, linkLabel, linkUrl, bareUrl] = match;
    if (index > position) nodes.push(text.slice(position, index));
    position = index + whole.length;

    if (escaped !== undefined) nodes.push(escaped);
    else if (code !== undefined) nodes.push(<code key={index}>{code}</code>);
    else if (bold !== undefined) nodes.push(<strong key={index}>{renderInline(bold)}</strong>);
    else if (italics !== undefined) nodes.push(<em key={index}>{renderInline(italics)}</em>);
    else if (linkUrl !== undefined) nodes.push(renderLink(index, renderInline(linkLabel), linkUrl));
    else nodes.push(renderLink(index, bareUrl, bareUrl));
  }
  if (position < text.length) nodes.push(text.slice(position));
  return nodes;
}

function renderText(text: string): ReactNode[] {
  return text.split(LINE_BREAK).map((line, index) => (
    <Fragment key={index}>
      {index > 0 && <br />}
      {renderInline(line.replace(/\n/g, ' '))}
    </Fragment>
  ));
}

function cellProps(align: Align) {
  return align ? { className: `memo-cell-${align}`, style: { textAlign: align } } : {};
}

function renderBlock(block: Block, key: number): ReactNode {
  switch (block.type) {
    case 'heading': {
      const Heading = `h${block.level}` as const;
      return <Heading key={key}>{renderInline(block.text)}</Heading>;
    }
    case 'paragraph':
      return <p key={key}>{renderText(block.text)}</p>;
    case 'list': {
      const items = block.items.map((item, index) => <li key={index}>{renderInline(item)}</li>);
      return block.ordered ? <ol key={key} start={block.start}>{items}</ol> : <ul key={key}>{items}</ul>;
    }
    case 'table':
      return (
        <div key={key} className="memo-table-wrap">
          <table>
            <thead>
              <tr>
                {block.header.map((cell, column) => (
                  <th key={column} {...cellProps(block.align[column])}>{renderInline(cell)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, index) => (
                <tr key={index}>
                  {row.map((cell, column) => (
                    <td key={column} {...cellProps(block.align[column])}>{renderInline(cell)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case 'quote':
      return <blockquote key={key}>{block.blocks.map(renderBlock)}</blockquote>;
    case 'code':
      return <pre key={key}><code>{block.text}</code></pre>;
    case 'rule':
      return <hr key={key} />;
  }
}

export default function Markdown({ source }: { source: string }) {
  return <>{parseBlocks(source).map(renderBlock)}</>;
}
