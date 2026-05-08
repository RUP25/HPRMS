'use strict';

/**
 * Fold Unicode decimal digits (General_Category=Nd, contiguous runs of 10)
 * to ASCII 0-9 so PINs match across scripts (e.g. Arabic-Indic in .env vs Latin from JSON).
 * Builds the Nd "digit ten" block table once on first use (~1M code points).
 */

const RE_ONE_ND = new RegExp('^\\p{Nd}$', 'u');

let cachedBlocks = null;

function ndDecimalBlocksOfTen() {
  if (cachedBlocks) return cachedBlocks;
  const blocks = [];
  let runStart = null;
  let runLen = 0;

  function flush() {
    if (runLen === 10 && runStart !== null) blocks.push(runStart);
    runStart = null;
    runLen = 0;
  }

  for (let cp = 0; cp <= 0x10ffff; cp++) {
    const ch = String.fromCodePoint(cp);
    if (RE_ONE_ND.test(ch)) {
      if (runStart === null) {
        runStart = cp;
        runLen = 1;
      } else if (cp === runStart + runLen) {
        runLen++;
      } else {
        flush();
        runStart = cp;
        runLen = 1;
      }
    } else {
      flush();
    }
  }
  flush();
  cachedBlocks = blocks.sort((a, b) => a - b);
  return cachedBlocks;
}

function digitFromDecimalNd(cp) {
  for (const b of ndDecimalBlocksOfTen()) {
    if (cp >= b && cp < b + 10) return cp - b;
  }
  return null;
}

function foldDecimalNdToAscii(pin) {
  if (!pin) return '';
  let out = '';
  for (let i = 0; i < pin.length; ) {
    const cp = pin.codePointAt(i);
    i += cp > 0xffff ? 2 : 1;
    const d = digitFromDecimalNd(cp);
    if (d !== null) out += String.fromCharCode(0x30 + d);
    else out += String.fromCodePoint(cp);
  }
  return out;
}

module.exports = { foldDecimalNdToAscii, ndDecimalBlocksOfTen };
