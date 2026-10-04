// The lodge's creature sprites (the same pixel art as Woltspace) and a small
// renderer: woltSpriteAvatar(creature, px) returns an <svg> string, or null.
const WOLT_SPRITES = {
  beaver: {
    map: ['..AAA........AAA.....', '.ABBBA......ABBBA....', '.ABAAAAAAAAAAAABA....', '.ABABBBBBBBBBAABA....', '..ABBBBBBBBBBBAA.....', '..ABABBBBAEBBBAA.....', '..ABABBBBAEBBBAA.....', '.ABBAAAABAEBBBBA.....', '.ABACAACCCFABBBA.....', '.ABACCACCCFABBBA.AAA.', '.ABBAAAAAAEBBBAAADDDA', '..ABBCAFABBBBAA.AADDA', '...ABAAAABBBBBBAADADA', '..ABBBBBBBBBBBBAADDAA', '.ABBABCCCAEBBBBBAADDA', '.ABBACCCABBBBABBADADA', '.AGGACCCAGGGGABBADADA', '..AAACCCAAAAABBBADDA.', '..ABCCCCCCFABBBBAAAA.', '.AAABCCCCAAAABBBAA...', 'ABBBACCCABBBBBBAA....', 'AAAAAAAAAAAAAAAA.....'],
    pal: {A:'#3f190e',B:'#af6127',C:'#fce6b0',D:'#773c1f',E:'#050003',F:'#fffee7',G:'#dd7a2d'}
  },
  otter: {
    map: ['.....AAAAAAAA......', '..AAACCCCCCCCAAA...', '.ACCCCCCCCCCCCCCA..', '.ACACCCCCCCCCCACA..', '..ACCBACCCCBACCA...', '..ACCAACDDCAACCA...', 'AAACBBBBAABBBBCAAA.', '..ABEBABAABABEBA...', '.AAABBBABBABBBAAA..', '...AABBBBBBBBAA....', '...ACCCCCCCCCCA....', '..ACCCCBBBBCCCCA...', '..ACCABBBBBBACCA...', '..ACCCABBBBACCCA...', '..AACCABBBBACCAA.AA', '..ACAABBBBBBAACAACA', '.ACCCBBBBBBBBCCCACA', '.ACAAABBBBBBAAACAA.', '.ACCCCABBBBACCCCA..', '..ACCCAAAAAACCCA...', '...AAA......AAA....'],
    pal: {A:'#402110',B:'#f2d79d',C:'#9f5332',D:'#ff6970',E:'#c47b4a'}
  },
  raccoon: {
    map: ['...BB........BBB.........', '...BFGG.....GFFB.........', '...BABB.....BAAB.........', '...BCAABBBBBACCB.........', '...BAAAAAAAAAAAB.........', '...BCCCCAAACCCCB.........', '...BCBCCAAACCCCB.........', '.BBCCBBCBCCCBCBCB........', '.BBACBBCAAACBCCAB........', '.BBCAAADHHHDAAACB...BBB..', '.BBCAAADHHHDAAACB...BBB..', '...BCAADDDDDAEEB...BCCCB.', '....BCCCCEEECBB....BAAACB', '...BAAAAAAAAAAAB...BCCCBB', '...BAAAAAAAAAAAB...BCCCCB', '.BBAAAAAAAAAAAAAB..BAAAAB', '.BBAABBAAAAABAAAB..BCCCCB', '.BBAAAABAAABAAAABBBAACCCB', '.GGFAAABAAABAAAAGBBAABBCG', 'BAABAAABAAABAAABABBCAAAB.', 'BAAABBBBAAABBBBAABBCCBB..', 'BCCAAAAAAAAAAAAACBBBB....', '.BBBBGGAAAAAGBBBB........', '.BBCCBBAAAAABCCCB........', '...BBBBBBBBBBBBB.........'],
    pal: {A:'#7f8894',B:'#282c33',C:'#40454b',D:'#f0ecf0',E:'#545c65',F:'#a0abbd',G:'#050029',H:'#efa09f'}
  }
};
WOLT_SPRITES.rodent = WOLT_SPRITES.raccoon;

function woltSpriteAvatar(type, size) {
  const s = WOLT_SPRITES[type];
  if (!s) return null;
  const map = s.map;
  // Compute the tight content bbox so non-square sprites don't get one-sided
  // padding inside a square SVG — the parent (flex/text-align) centers the
  // content-sized SVG and any empty space is symmetric.
  let minR = Infinity, maxR = -1, minC = Infinity, maxC = -1;
  for (let r = 0; r < map.length; r++) for (let c = 0; c < map[r].length; c++) {
    const ch = map[r][c];
    if (ch === '.' || ch === ' ' || !s.pal[ch]) continue;
    if (r < minR) minR = r; if (r > maxR) maxR = r;
    if (c < minC) minC = c; if (c > maxC) maxC = c;
  }
  if (maxR < 0) return null;
  const bw = maxC - minC + 1, bh = maxR - minR + 1;
  const px = size / Math.max(bw, bh);
  const w = bw * px, h = bh * px;
  let rects = '';
  for (let r = minR; r <= maxR; r++) for (let c = minC; c <= Math.min(maxC, map[r].length - 1); c++) {
    const ch = map[r][c]; if (ch === '.' || ch === ' ') continue;
    const fill = s.pal[ch]; if (!fill) continue;
    rects += `<rect x="${((c - minC) * px).toFixed(2)}" y="${((r - minR) * px).toFixed(2)}" width="${px.toFixed(2)}" height="${px.toFixed(2)}" fill="${fill}"/>`;
  }
  return `<svg width="${w.toFixed(1)}" height="${h.toFixed(1)}" xmlns="http://www.w3.org/2000/svg" style="image-rendering:pixelated;display:block;margin:0 auto" shape-rendering="crispEdges">${rects}</svg>`;
}
