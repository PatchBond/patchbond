use std::io::{Read, Write};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use crate::http;

use base64::Engine;
use patchbond_judge::facts::{self, CheckRun, Contribution, Issue, OpenItem, SymbolIndex};
use patchbond_judge::{compute_facts, decide, record, request_for, symbols, Gathered, Input, NearAiSignature, Output};
use serde_json::Value;

const GITHUB: &str = "https://api.github.com";
const NEAR_AI: &str = "https://cloud-api.near.ai/v1";
/// Our own check run on the PR isn't CI evidence (server/src/github/text.ts CHECK_NAME).
const CHECK_NAME: &str = "PatchBond";

pub fn run() {
    let mut raw = String::new();
    let _ = std::io::stdin().read_to_string(&mut raw);
    let input: Input = match serde_json::from_str(&raw) {
        Ok(i) => i,
        Err(e) => {
            println!(r#"{{"status":"skip","reason":"bad input: {}"}}"#, e.to_string().replace('"', "'"));
            return;
        }
    };
    let out = judge(&input).unwrap_or_else(|reason| Output::not_judged(&input, "skip", reason));
    let line = serde_json::to_string(&out).unwrap();
    print!("{line}");
    let _ = std::io::stdout().flush();
}

fn judge(input: &Input) -> Result<Output, String> {
    let gh = GitHub { token: std::env::var("GITHUB_TOKEN").ok().filter(|t| !t.is_empty()) };
    let key = std::env::var("NEARAI_API_KEY").map_err(|_| "NEARAI_API_KEY secret is missing")?;

    let repo = gh.json(&format!("{GITHUB}/repositories/{}", input.repo_id))?;
    let full = repo["full_name"].as_str().ok_or("repository has no full_name")?.to_string();
    let base = format!("{GITHUB}/repos/{full}");
    let pr = gh.json(&format!("{base}/pulls/{}", input.number))?;
    let author = pr["user"]["login"].as_str().unwrap_or("ghost").to_string();
    if !author.eq_ignore_ascii_case(&input.github_user) {
        return Ok(Output::not_judged(input, "skip", format!("PR author is {author}, the bond was paid for {}", input.github_user)));
    }
    let head = pr["head"]["sha"].as_str().ok_or("PR has no head sha")?.to_string();
    let base_sha = pr["base"]["sha"].as_str().ok_or("PR has no base sha")?.to_string();

    let checks: Vec<CheckRun> = gh
        .json(&format!("{base}/commits/{head}/check-runs?per_page=100"))
        .ok()
        .and_then(|v| serde_json::from_value(v["check_runs"].clone()).ok())
        .unwrap_or_default();
    if checks.iter().any(|c| c.status != "completed" && !c.name.starts_with(CHECK_NAME)) {
        return Ok(Output::not_judged(input, "wait", "CI is still running on the head commit; ask again when it finishes"));
    }

    let diff = gh.text(&format!("{base}/pulls/{}", input.number), "application/vnd.github.diff")?;
    let mut files = Vec::new();
    for page in 1..=30 {
        let batch = gh.json(&format!("{base}/pulls/{}/files?per_page=100&page={page}", input.number))?;
        let names: Vec<String> = batch.as_array().into_iter().flatten().filter_map(|f| f["filename"].as_str().map(String::from)).collect();
        let n = names.len();
        files.extend(names);
        if n < 100 {
            break;
        }
    }
    let open_items: Vec<OpenItem> = gh
        .json(&format!("{base}/pulls?state=open&per_page=50"))?
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|p| Some(OpenItem { number: p["number"].as_u64()?, title: p["title"].as_str()?.to_string() }))
        .collect();
    let contributing = ["", ".github/", "docs/"].iter().find_map(|d| gh.file(&base, &format!("{d}CONTRIBUTING.md"), &base_sha));
    let rules_text = [".github/", ""].iter().find_map(|d| gh.file(&base, &format!("{d}patchbond.yml"), &base_sha));

    let contribution = Contribution {
        number: input.number,
        title: pr["title"].as_str().unwrap_or("").to_string(),
        body: pr["body"].as_str().unwrap_or("").to_string(),
        diff,
        files,
        additions: pr["additions"].as_u64().unwrap_or(0),
        deletions: pr["deletions"].as_u64().unwrap_or(0),
    };
    let issue = facts::linked_issue(&format!("{}\n{}", contribution.title, contribution.body)).map(|n| gh.issue(&base, n));
    let g = Gathered { full_name: full.clone(), author, contribution, check_runs: checks, open_items, contributing, rules_text, issue };

    let facts = compute_facts(&g, &input.reputation, || {
        let tgz = gh.bytes(&format!("{base}/tarball/{base_sha}")).ok()?;
        symbols::index_identifiers(&tgz).ok().map(|i| Box::new(i) as Box<dyn SymbolIndex>)
    });
    let request_body = request_for(&input.model, &g, &facts);

    let (chat_id, response_body, sig) = near_ai(&key, &input.model, &request_body)?;
    let j = decide(input, &g, facts, &response_body, &sig.text);
    let out = Output::judged(input, &j, &request_body, &response_body, &sig);

    if let Some(url) = &input.record_url {
        let rec = record(input, &g, &j, &chat_id, &request_body, &response_body, &sig, &now_iso());
        // Best effort: the record's hashes are on-chain, so whoever serves it can't alter it.
        let _ = http::post(url, &[("content-type", "application/json".into())], rec.to_string().as_bytes());
    }
    Ok(out)
}

fn near_ai(key: &str, model: &str, request_body: &str) -> Result<(String, String, NearAiSignature), String> {
    let auth = format!("Bearer {key}");
    let res = http::post(
        &format!("{NEAR_AI}/chat/completions"),
        &[("authorization", auth.clone()), ("content-type", "application/json".into()), ("x-no-aliasing", "true".into())],
        request_body.as_bytes(),
    )
    .map_err(|e| format!("NEAR AI unreachable: {e}"))?;
    let response_body = String::from_utf8_lossy(&res.body).into_owned();
    if !(200..300).contains(&res.status) {
        return Err(format!("NEAR AI chat failed: HTTP {}: {}", res.status, response_body.chars().take(120).collect::<String>()));
    }
    let chat_id = serde_json::from_str::<Value>(&response_body).ok().and_then(|v| v["id"].as_str().map(String::from)).ok_or("NEAR AI response has no id")?;
    let url = format!("{NEAR_AI}/signature/{chat_id}?model={}&signing_algo=ecdsa", model.replace('/', "%2F"));
    for attempt in 1..=6 {
        if let Ok(r) = http::get(&url, &[("authorization", auth.clone())]) {
            if r.status == 200 {
                if let Ok(sig) = serde_json::from_slice::<NearAiSignature>(&r.body) {
                    return Ok((chat_id, response_body, sig));
                }
            }
        }
        std::thread::sleep(Duration::from_millis(500 * attempt));
    }
    Err(format!("NEAR AI signature for {chat_id} unavailable"))
}

struct GitHub {
    token: Option<String>,
}

impl GitHub {
    fn get(&self, url: &str, accept: &str) -> Result<Vec<u8>, String> {
        let mut url = url.to_string();
        for _ in 0..4 {
            let mut headers = vec![
                ("user-agent", "patchbond-outlayer-judge".to_string()),
                ("accept", accept.to_string()),
                ("x-github-api-version", "2022-11-28".to_string()),
            ];
            // Never send our token to wherever a redirect points (e.g. codeload for tarballs).
            if let (Some(t), true) = (&self.token, url.starts_with(GITHUB)) {
                headers.push(("authorization", format!("Bearer {t}")));
            }
            let res = http::get(&url, &headers).map_err(|e| format!("GitHub unreachable: {e}"))?;
            match res.status {
                200 => return Ok(res.body),
                301 | 302 | 307 | 308 => url = res.location.ok_or("redirect without location")?,
                s => return Err(format!("GitHub {s} for {}", url.trim_start_matches(GITHUB))),
            }
        }
        Err("too many redirects".into())
    }

    fn bytes(&self, url: &str) -> Result<Vec<u8>, String> {
        self.get(url, "application/vnd.github+json")
    }

    fn text(&self, url: &str, accept: &str) -> Result<String, String> {
        Ok(String::from_utf8_lossy(&self.get(url, accept)?).into_owned())
    }

    fn json(&self, url: &str) -> Result<Value, String> {
        serde_json::from_str(&self.text(url, "application/vnd.github+json")?).map_err(|e| format!("GitHub JSON: {e}"))
    }

    /// A file at `sha`, decoded like Octokit's `getContent` + `Buffer.from(…, "base64")`.
    fn file(&self, base: &str, path: &str, sha: &str) -> Option<String> {
        let v = self.json(&format!("{base}/contents/{path}?ref={sha}")).ok()?;
        let b64: String = v["content"].as_str()?.chars().filter(|c| !c.is_whitespace()).collect();
        let bytes = base64::engine::general_purpose::STANDARD.decode(b64).ok()?;
        Some(String::from_utf8_lossy(&bytes).into_owned())
    }

    fn issue(&self, base: &str, n: u64) -> Issue {
        match self.json(&format!("{base}/issues/{n}")) {
            Ok(v) if v["number"].is_u64() => Issue {
                number: n,
                exists: true,
                open: v["state"] == "open",
                title: v["title"].as_str().map(String::from),
                assignees: Some(v["assignees"].as_array().into_iter().flatten().filter_map(|a| a["login"].as_str().map(String::from)).collect()),
            },
            _ => Issue { number: n, exists: false, open: false, title: None, assignees: None },
        }
    }
}

/// `new Date().toISOString()`.
fn now_iso() -> String {
    let ms = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0);
    let (days, rem) = (ms.div_euclid(86_400_000), ms.rem_euclid(86_400_000));
    // Civil-from-days (Howard Hinnant).
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + i64::from(m <= 2);
    format!("{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}.{:03}Z", rem / 3_600_000, rem / 60_000 % 60, rem / 1000 % 60, rem % 1000)
}
