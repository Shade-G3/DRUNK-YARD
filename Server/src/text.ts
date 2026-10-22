/** Shared text sanitising for anything users type that others will see. */
const LINK_RE =
  /\b(?:https?:\/\/|www\.)\S+|\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|net|org|io|ly|me|in|co|xyz|app|link|gg|tv|to|ru|cc|biz|info|site|online|live|club|top|vip|shop|fun|cam|xxx|sex|onion)\b(?:\/\S*)?/gi;

export function scrubLinks(text: string): string {
  return text.replace(LINK_RE, "[link removed]");
}

/** Strip control chars, zero-width and bidi-override characters (used to spoof text). */
export function stripInvisible(text: string): string {
  return text.replace(/[\u0000-\u001f\u007f​-‏‪-‮⁦-⁩]/g, " ");
}
