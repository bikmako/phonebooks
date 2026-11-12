// Scanner-only validation. Existing manual entry and domain rules stay unchanged.
export function isValidImei(value) {
  if (typeof value !== 'string' || !/^\d{15}$/.test(value) || /^(\d)\1{14}$/.test(value)) return false;
  const sum = [...value].reduce((total, digit, index) => {
    const n = Number(digit) * (index % 2 ? 2 : 1);
    return total + (n > 9 ? n - 9 : n);
  }, 0);
  return sum % 10 === 0;
}

export function extractImeis(text) {
  const found = new Set();
  for (const line of String(text ?? '').split(/[\r\n]+/)) {
    // Other identifiers can also be numeric and occasionally pass Luhn.
    if (/\b(?:EID|ICCID|MEID|IMEISV|S\/?N|SERIAL)\b/i.test(line) && !/\bIMEI(?:[12])?\b/i.test(line)) continue;
    // Never take a 15-digit substring of an EID, IMEISV, serial or a longer number.
    // No O→0 / I→1 substitutions or checksum repairs: ambiguity requires a rescan.
    for (const match of line.matchAll(/(?:^|[^a-zA-Z0-9])(\d+)(?![a-zA-Z0-9])/g)) {
      if (isValidImei(match[1])) found.add(match[1]);
    }
    for (const match of line.matchAll(/(?:^|[^a-zA-Z0-9])([0-9]+(?:[ \t\u00a0-]+[0-9]+)+)(?![a-zA-Z0-9])/g)) {
      const value = match[1].replace(/[ \t\u00a0-]/g, '');
      if (isValidImei(value)) found.add(value);
    }
  }
  return [...found];
}

export function imeisFromOcr(data) {
  const found = new Set();
  for (const block of data.blocks ?? []) {
    for (const paragraph of block.paragraphs ?? []) {
      for (const line of paragraph.lines ?? []) {
        // Assess numeric words, not page-wide confidence (a clear title can mask a blurry IMEI).
        // Low confidence words remain separators, so numbers cannot be joined across them.
        const text = (line.words ?? []).map(word =>
          /\d/.test(word.text) && (!Number.isFinite(word.confidence) || word.confidence < 80)
            ? ' ? ' : word.text,
        ).join(' ');
        for (const value of extractImeis(text)) found.add(value);
      }
    }
  }
  return [...found];
}

export function ocrLines(data) {
  return (data.blocks ?? []).flatMap(block => (block.paragraphs ?? []).flatMap(paragraph => paragraph.lines ?? []));
}

export function ocrReadings(data) {
  return ocrLines(data).flatMap(line => {
    const words = line.words ?? [];
    const text = words.map(word => word.text).join(' ');
    const numeric = words.filter(word => /\d{3}/.test(word.text) || /^[\d\s-]+$/.test(word.text));
    const confidence = numeric.length ? Math.min(...numeric.map(word => Number.isFinite(word.confidence) ? word.confidence : 0)) : 0;
    return extractImeis(text).map(imei => ({ imei, confidence }));
  });
}

export function reliableOcr(readings) {
  const observations = new Map();
  for (const { pass, imei, confidence } of readings) {
    if (!isValidImei(imei) || confidence < 45) continue;
    const entry = observations.get(imei) ?? { passes: new Set(), best: 0 };
    entry.passes.add(pass); entry.best = Math.max(entry.best, confidence);
    observations.set(imei, entry);
  }
  return [...observations].filter(([, value]) => value.best >= 82 || value.passes.size >= 2 && value.best >= 60).map(([imei]) => imei);
}
