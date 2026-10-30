//! JavaScript semantics the judge depends on, so this program builds the same prompt bytes as the
//! TypeScript server (`server/src/judge/`): JS regexes (ASCII `\d`/`\w`, `.` that stops at line
//! terminators, JS `\s`), UTF-16 `length`/`slice`, `trim` and `Math.round`.
//!
//! Regex sources below are copied verbatim from the TypeScript and translated by [`re`].

use fancy_regex::Regex;

/// JS `\s`: WhiteSpace + LineTerminator (includes U+FEFF; unlike Rust's, excludes U+0085).
const JS_SPACE: &str = r"\t\n\x0B\x0C\r \u{a0}\u{1680}\u{2000}-\u{200a}\u{2028}\u{2029}\u{202f}\u{205f}\u{3000}\u{feff}";
/// JS `.` (no `s` flag): anything but a line terminator.
const JS_DOT: &str = r"[^\n\r\u{2028}\u{2029}]";

/// Compiles a JS regex source with JS meaning. `flags` may contain `i`.
pub fn re(src: &str, flags: &str) -> Regex {
    let mut out = String::with_capacity(src.len() * 2);
    if flags.contains('i') {
        out.push_str("(?i)");
    }
    let mut in_class = false;
    let mut chars = src.chars().peekable();
    while let Some(c) = chars.next() {
        match c {
            '\\' => {
                let Some(e) = chars.next() else { break };
                out.push_str(&match (e, in_class) {
                    ('d', false) => "[0-9]".into(),
                    ('d', true) => "0-9".into(),
                    ('D', false) => "[^0-9]".into(),
                    ('w', false) => "[A-Za-z0-9_]".into(),
                    ('w', true) => "A-Za-z0-9_".into(),
                    ('W', false) => "[^A-Za-z0-9_]".into(),
                    ('s', false) => format!("[{JS_SPACE}]"),
                    ('s', true) => format!("[{JS_SPACE}]"),
                    ('S', _) => format!("[^{JS_SPACE}]"),
                    ('/', _) => "/".into(),
                    _ => format!("\\{e}"),
                });
            }
            '[' if !in_class => {
                in_class = true;
                out.push('[');
                if chars.peek() == Some(&'^') {
                    out.push(chars.next().unwrap());
                }
                // A leading `]` is literal in neither language's sense here; JS never uses it.
            }
            '[' => out.push_str("\\["),
            ']' if in_class => {
                in_class = false;
                out.push(']');
            }
            '.' if !in_class => out.push_str(JS_DOT),
            '&' | '~' | '-' if in_class && chars.peek() == Some(&c) => {
                // Rust treats `&&`, `~~`, `--` in a class as set operations; JS treats them literally.
                out.push('\\');
                out.push(c);
            }
            _ => out.push(c),
        }
    }
    Regex::new(&out).unwrap_or_else(|e| panic!("bad regex {src:?} → {out:?}: {e}"))
}

pub fn is_match(r: &Regex, s: &str) -> bool {
    r.is_match(s).unwrap_or(false)
}

/// `s.match(r)?.[0]` / `?.[1]`.
pub fn first(r: &Regex, s: &str, group: usize) -> Option<String> {
    r.captures(s).ok().flatten().and_then(|c| c.get(group).map(|m| m.as_str().to_string()))
}

/// `[...s.matchAll(r)].map(m => m[group])`.
pub fn all(r: &Regex, s: &str, group: usize) -> Vec<String> {
    r.captures_iter(s)
        .filter_map(|c| c.ok())
        .filter_map(|c| c.get(group).map(|m| m.as_str().to_string()))
        .collect()
}

/// `s.replace(r, with)` — first match only (a JS regex without `g`).
pub fn replace_first(r: &Regex, s: &str, with: &str) -> String {
    match r.find(s).ok().flatten() {
        Some(m) => format!("{}{}{}", &s[..m.start()], with, &s[m.end()..]),
        None => s.to_string(),
    }
}

/// `s.replace(r, with)` with the `g` flag; `with` gets the captures.
pub fn replace_all(r: &Regex, s: &str, with: impl Fn(&fancy_regex::Captures) -> String) -> String {
    let mut out = String::with_capacity(s.len());
    let mut last = 0;
    for c in r.captures_iter(s).filter_map(|c| c.ok()) {
        let m = c.get(0).unwrap();
        out.push_str(&s[last..m.start()]);
        out.push_str(&with(&c));
        last = m.end();
    }
    out.push_str(&s[last..]);
    out
}

/// `s.split(r)` for a regex without capture groups.
pub fn split<'a>(r: &Regex, s: &'a str) -> Vec<&'a str> {
    let mut out = Vec::new();
    let mut last = 0;
    for m in r.find_iter(s).filter_map(|m| m.ok()) {
        if m.end() == m.start() && m.start() == last && last == 0 && s.is_empty() {
            continue;
        }
        if m.start() == m.end() && (m.start() == 0 || m.start() == s.len()) {
            continue; // JS never splits at the very ends on an empty match
        }
        out.push(&s[last..m.start()]);
        last = m.end();
    }
    out.push(&s[last..]);
    out
}

/// `s.length` (UTF-16 code units).
pub fn len16(s: &str) -> usize {
    s.chars().map(char::len_utf16).sum()
}

/// `s.slice(0, n)` in UTF-16 units. A surrogate pair split by JS becomes a lone surrogate; here the
/// whole character is dropped instead (Rust strings can't hold half of one).
pub fn slice16(s: &str, n: usize) -> &str {
    let mut units = 0;
    for (i, c) in s.char_indices() {
        units += c.len_utf16();
        if units > n {
            return &s[..i];
        }
    }
    s
}

fn is_js_space(c: char) -> bool {
    matches!(c, '\t' | '\n' | '\u{b}' | '\u{c}' | '\r' | ' ' | '\u{a0}' | '\u{1680}' | '\u{2000}'..='\u{200a}' | '\u{2028}' | '\u{2029}' | '\u{202f}' | '\u{205f}' | '\u{3000}' | '\u{feff}')
}

/// `s.trim()`.
pub fn trim(s: &str) -> &str {
    s.trim_matches(is_js_space)
}

/// `Math.round(x)`: ties go toward +∞.
pub fn round(x: f64) -> f64 {
    let f = x.floor();
    if x - f >= 0.5 {
        f + 1.0
    } else {
        f
    }
}

/// `s.toLowerCase()`.
pub fn lower(s: &str) -> String {
    s.to_lowercase()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn translated_semantics() {
        // `.` stops at \r like JS, so a CRLF line keeps its comment.
        assert!(!is_match(&re(r"//.*$", ""), "x // c\r"));
        assert!(is_match(&re(r"(?<![.\w>:])foo", ""), "a foo"));
        assert!(!is_match(&re(r"\w", ""), "é"));
        assert_eq!(split(&re(r"(?<=[.!?])\s+(?=[A-Z])", ""), "One. Two! three. Four"), vec!["One.", "Two! three.", "Four"]);
        assert_eq!(slice16("a😀b", 2), "a");
        assert_eq!(len16("a😀b"), 4);
        assert_eq!(round(0.665 * 100.0) / 100.0, 0.67);
        assert_eq!(trim("\u{feff} x \r"), "x");
        assert!(is_match(&re(r"[\s\S]", ""), "\n"));
    }
}
