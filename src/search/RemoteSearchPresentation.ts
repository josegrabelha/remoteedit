export function renderRemoteSearchSnippetFunctions(): string {
  return `  function findRemoteSearchTextMatches(text, needle, caseSensitive) {
    const source = String(text || '');
    const query = String(needle || '');
    if (!query) return [];
    const haystack = caseSensitive ? source : source.toLowerCase();
    const target = caseSensitive ? query : query.toLowerCase();
    const matches = [];
    let index = 0;
    while (index <= haystack.length) {
      const found = haystack.indexOf(target, index);
      if (found < 0) break;
      matches.push({ start: found, end: found + target.length });
      index = Math.max(found + target.length, found + 1);
      if (matches.length >= 50) break;
    }
    return matches;
  }

  function buildRemoteSearchSnippetRanges(text, matches) {
    const source = String(text || '');
    const maxFullLength = 220;
    const before = 70;
    const after = 90;
    const maxRanges = 3;
    if (source.length <= maxFullLength || !matches.length) {
      return [{ start: 0, end: Math.min(source.length, maxFullLength), leading: false, trailing: source.length > maxFullLength }];
    }

    const ranges = [];
    for (const match of matches.slice(0, maxRanges)) {
      const start = Math.max(0, match.start - before);
      const end = Math.min(source.length, match.end + after);
      const previous = ranges[ranges.length - 1];
      if (previous && start <= previous.end + 12) {
        previous.end = Math.max(previous.end, end);
      } else {
        ranges.push({ start, end, leading: start > 0, trailing: false });
      }
    }
    ranges.forEach((range, index) => {
      range.leading = range.start > 0;
      range.trailing = range.end < source.length || index < ranges.length - 1;
    });
    return ranges;
  }

  function renderRemoteSearchMatchSnippet(text, query, caseSensitive) {
    const source = String(text || '');
    const matches = findRemoteSearchTextMatches(source, query, caseSensitive);
    const ranges = buildRemoteSearchSnippetRanges(source, matches);
    if (!matches.length) {
      const plain = source.length > 220 ? source.slice(0, 220) + '…' : source;
      return escapeHtml(plain);
    }

    let html = '';
    for (const range of ranges) {
      if (range.leading) html += '<span class="remote-search-ellipsis">…</span>';
      let cursor = range.start;
      for (const match of matches) {
        if (match.end <= range.start || match.start >= range.end) continue;
        const highlightStart = Math.max(match.start, range.start);
        const highlightEnd = Math.min(match.end, range.end);
        if (highlightStart > cursor) {
          html += escapeHtml(source.slice(cursor, highlightStart));
        }
        html += '<span class="remote-search-hit">' + escapeHtml(source.slice(highlightStart, highlightEnd)) + '</span>';
        cursor = highlightEnd;
      }
      if (cursor < range.end) {
        html += escapeHtml(source.slice(cursor, range.end));
      }
      if (range.trailing) html += '<span class="remote-search-ellipsis">…</span>';
    }
    return html;
  }

`;
}
