const kokoroPronunciationMap = new Map<string, string>([
  ["小野リサ", "Lisa Ono"],
  ["坂本龍一", "Ryuichi Sakamoto"]
]);

const cjkTextPattern = /[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff\uac00-\ud7af]/;

export function prepareKokoroSpokenText(text: string): string {
  let spoken = text;
  for (const [source, replacement] of kokoroPronunciationMap) {
    spoken = spoken.split(source).join(replacement);
  }
  return removeUnknownCjkLeadArtistMention(removeUnknownCjkArtistCredit(spoken));
}

function removeUnknownCjkArtistCredit(text: string): string {
  return text.replace(/\bby\s+([^,;.!?\n]*[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff\uac00-\ud7af][^,;.!?\n]*)([,;.!?]?)/gi, (_match, artist: string, punctuation: string) => {
    const ending = punctuation || ".";
    return cjkTextPattern.test(artist) ? `next${ending}` : `by ${artist}${ending}`;
  });
}

function removeUnknownCjkLeadArtistMention(text: string): string {
  return text.replace(/\b(first up|next up),?\s+([^,;.!?\n]*[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff\uac00-\ud7af][^,;.!?\n]*?)\s+with\b/gi, (match, lead: string, artist: string) => {
    return cjkTextPattern.test(artist) ? `${lead}, this track with` : match;
  });
}
