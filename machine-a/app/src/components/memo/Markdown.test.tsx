import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import Markdown, { parseBlocks, safeHref } from './Markdown';

const html = (source: string) => renderToStaticMarkup(<Markdown source={source} />);

describe('Markdown', () => {
  it('renders headings, bold and italics', () => {
    expect(html('# Titolo\n\n## Sotto')).toBe('<h1>Titolo</h1><h2>Sotto</h2>');
    expect(html('Un **forte** e *lieve* accento')).toBe('<p>Un <strong>forte</strong> e <em>lieve</em> accento</p>');
    expect(html('**Grassetto con [link](https://a.it)**')).toContain('<strong>Grassetto con <a href="https://a.it/"');
  });

  it('renders lists, with continuation lines and flattened nesting', () => {
    expect(html('- uno\n- due\n  segue\n  - interno')).toBe('<ul><li>uno</li><li>due segue</li><li>interno</li></ul>');
    expect(html('3. tre\n4. quattro')).toBe('<ol start="3"><li>tre</li><li>quattro</li></ol>');
    expect(html('- uno\n\n- due\n\nFine')).toBe('<ul><li>uno</li><li>due</li></ul><p>Fine</p>');
  });

  it('renders tables, aligned, with short rows padded and escaped pipes kept', () => {
    const table = html('| Zona | Budget |\n| --- | ---: |\n| A \\| B | 10 € |\n| C |');
    expect(table).toContain('<th>Zona</th>');
    expect(table).toContain('<th class="memo-cell-right" style="text-align:right">Budget</th>');
    expect(table).toContain('<td>A | B</td>');
    expect(table).toContain('<td>C</td><td class="memo-cell-right" style="text-align:right"></td>');
  });

  it('renders quotes, rules, code and hard line breaks', () => {
    expect(html('> **Nota** importante')).toBe('<blockquote><p><strong>Nota</strong> importante</p></blockquote>');
    expect(html('sopra\n\n---\n\nsotto')).toBe('<p>sopra</p><hr/><p>sotto</p>');
    expect(html('uno  \ndue\ntre')).toBe('<p>uno<br/>due tre</p>');
    expect(html('```\n**testo**\n```')).toBe('<pre><code>**testo**</code></pre>');
  });

  it('gives React unique keys when several lines hold the same kind of element', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(html('**uno**  \n**due**')).toBe('<p><strong>uno</strong><br/><strong>due</strong></p>');
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('opens http links in a new tab, without access to the opener', () => {
    expect(html('[Fonte](https://aperto.comune.torino.it/dataset)'))
      .toBe('<p><a href="https://aperto.comune.torino.it/dataset" target="_blank" rel="noopener noreferrer">Fonte</a></p>');
    expect(html('Vedi https://a.it/b, grazie.')).toContain('href="https://a.it/b"');
    expect(html('Vedi https://a.it/b, grazie.')).toContain('</a>, grazie.');
  });

  it('keeps HTML as visible text', () => {
    const rendered = html('<script>alert(1)</script> <img src=x onerror=alert(1)>\n\n| <b>x</b> | y |\n| --- | --- |\n| <i>1</i> | 2 |');
    expect(rendered).not.toContain('<script');
    expect(rendered).not.toContain('<img');
    expect(rendered).not.toContain('<b>');
    expect(rendered).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('never turns an unsafe address into a link', () => {
    for (const url of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,x', 'vbscript:x', 'file:///c:/x', '/relativo']) {
      const rendered = html(`[clicca](${url})`);
      expect(rendered).not.toContain('<a');
      expect(rendered).toContain('clicca');
    }
    expect(safeHref('java\tscript:alert(1)')).toBeNull();
    expect(safeHref('mailto:a@b.it')).toBe('mailto:a@b.it');
  });

  it('leaves plain arithmetic and escaped characters alone', () => {
    expect(html('3 * 4 * 5')).toBe('<p>3 * 4 * 5</p>');
    expect(html('\\*non corsivo\\*')).toBe('<p>*non corsivo*</p>');
    expect(html('snake_case_name')).toBe('<p>snake_case_name</p>');
  });

  it('does not take a pipe in a sentence for a table', () => {
    expect(parseBlocks('a | b\nseconda riga')).toEqual([{ type: 'paragraph', text: 'a | b\nseconda riga' }]);
  });

  it('copes with empty input, an unclosed fence and Windows line endings', () => {
    expect(html('')).toBe('');
    expect(html('```\ncodice')).toBe('<pre><code>codice</code></pre>');
    expect(html('# Uno\r\n\r\ndue\r\n')).toBe('<h1>Uno</h1><p>due</p>');
  });
});
