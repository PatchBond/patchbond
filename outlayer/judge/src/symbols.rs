//! Port of `server/src/github/symbols.ts`: every identifier in the repo at the base commit, from
//! one tarball download.

use std::collections::{HashMap, HashSet};
use std::io::Read;
use std::sync::LazyLock;

use fancy_regex::Regex;

use crate::facts::{namespace_of, SymbolIndex};
use crate::js::{self, re};

static SOURCE: LazyLock<Regex> = LazyLock::new(|| {
    re(
        r"\.(c|h|cc|cpp|hpp|cxx|rs|go|py|pyi|js|jsx|ts|tsx|mjs|cjs|java|kt|scala|rb|php|cs|swift|m|mm|lua|sh|bash|zig|ex|exs|erl|hs|ml|dart|vue|svelte|sql|pl|r|jl|nim|v|sv|vhd|cmake|mk|in|ac|y|l)$|(^|\/)(Makefile|CMakeLists\.txt|configure)$",
        "i",
    )
});
const MAX_FILE: usize = 1_000_000;

/// Minimal ustar reader: regular files only, honours the 155-byte prefix and pax long names.
pub fn tar_entries(tar: &[u8]) -> Vec<(String, &[u8])> {
    let str_at = |o: usize, n: usize| -> String {
        let b = &tar[o..(o + n).min(tar.len())];
        let s = String::from_utf8_lossy(b);
        s.split('\0').next().unwrap_or("").to_string()
    };
    let mut out = Vec::new();
    let mut off = 0;
    let mut pax_name: Option<String> = None;
    while off + 512 <= tar.len() {
        let name = str_at(off, 100);
        if name.is_empty() {
            break;
        }
        let size = usize::from_str_radix(str_at(off + 124, 12).trim(), 8).unwrap_or(0);
        let kind = tar[off + 156];
        let prefix = str_at(off + 345, 155);
        let body = &tar[(off + 512).min(tar.len())..(off + 512 + size).min(tar.len())];
        match kind {
            b'x' => {
                let text = String::from_utf8_lossy(body);
                pax_name = text.split('\n').find_map(|l| l.split_once(" path=").map(|(_, p)| p.to_string()));
            }
            b'0' | 0 => {
                let full = pax_name.take().unwrap_or_else(|| if prefix.is_empty() { name } else { format!("{prefix}/{name}") });
                out.push((full, body));
            }
            b'g' => {}
            _ => pax_name = None,
        }
        off += 512 + size.div_ceil(512) * 512;
    }
    out
}

pub struct Index {
    ids: HashSet<String>,
    namespaces: HashMap<String, usize>,
}

impl SymbolIndex for Index {
    fn has(&self, id: &str) -> bool {
        self.ids.contains(id)
    }
    fn namespace_size(&self, ns: &str) -> usize {
        self.namespaces.get(ns).copied().unwrap_or(0)
    }
}

pub fn index_identifiers(tar_gz: &[u8]) -> std::io::Result<Index> {
    let mut tar = Vec::new();
    flate2::read::GzDecoder::new(tar_gz).read_to_end(&mut tar)?;
    let mut ids = HashSet::new();
    for (name, data) in tar_entries(&tar) {
        if !js::is_match(&SOURCE, &name) || data.len() > MAX_FILE {
            continue;
        }
        let text = String::from_utf8_lossy(data);
        for m in IDENT.find_iter(&text) {
            ids.insert(m.as_str().to_string());
        }
    }
    let mut namespaces = HashMap::new();
    for id in &ids {
        if let Some(ns) = namespace_of(id) {
            *namespaces.entry(ns).or_insert(0) += 1;
        }
    }
    Ok(Index { ids, namespaces })
}

/// Plain (non-backtracking) engine: megabytes of source go through it.
static IDENT: LazyLock<regex::Regex> = LazyLock::new(|| regex::Regex::new(r"[A-Za-z_][A-Za-z0-9_]{3,}").unwrap());

/// An index from a known identifier list (tests and fixtures).
pub fn from_ids(list: impl IntoIterator<Item = String>) -> Index {
    let ids: HashSet<String> = list.into_iter().collect();
    let mut namespaces = HashMap::new();
    for id in &ids {
        if let Some(ns) = namespace_of(id) {
            *namespaces.entry(ns).or_insert(0) += 1;
        }
    }
    Index { ids, namespaces }
}
