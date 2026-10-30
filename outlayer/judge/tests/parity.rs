//! The enclave program must build the same facts and the same NEAR AI request bytes as the
//! TypeScript server, and reach the same final verdict and verdict hash. Fixtures come from the
//! real labelled PRs via `server/scripts/make-outlayer-fixtures.ts`.

use std::collections::HashMap;

use patchbond_judge::facts::{Facts, SymbolIndex};
use patchbond_judge::{compute_facts, decide, request_for, Gathered, Input};
use serde::Deserialize;
use serde_json::Value;

#[derive(Deserialize)]
struct Symbols {
    present: Vec<String>,
    namespaces: HashMap<String, usize>,
}

impl SymbolIndex for Symbols {
    fn has(&self, id: &str) -> bool {
        self.present.iter().any(|p| p == id)
    }
    fn namespace_size(&self, ns: &str) -> usize {
        self.namespaces.get(ns).copied().unwrap_or(0)
    }
}

#[derive(Deserialize)]
struct Decision {
    response_body: String,
    #[serde(rename = "final")]
    final_: Value,
    verdict_hash: String,
}

#[derive(Deserialize)]
struct Case {
    reputation: String,
    facts: Value,
    request_body: String,
    signed_text: String,
    decisions: Vec<Decision>,
}

#[derive(Deserialize)]
struct Fixture {
    url: String,
    repo_id: u64,
    gathered: Gathered,
    symbols: Option<Symbols>,
    cases: Vec<Case>,
}

fn first_difference(a: &str, b: &str) -> String {
    let i = a.chars().zip(b.chars()).take_while(|(x, y)| x == y).count();
    let at = |s: &str| s.chars().skip(i.saturating_sub(60)).take(140).collect::<String>();
    format!("at char {i}:\n  rust: {:?}\n  ts:   {:?}", at(a), at(b))
}

#[test]
fn same_bytes_as_the_typescript_judge() {
    let fixtures: Vec<Fixture> = serde_json::from_str(include_str!("fixtures/parity.json")).unwrap();
    assert!(fixtures.len() >= 25, "expected the labelled set, got {}", fixtures.len());
    let mut checked = 0;
    for mut f in fixtures {
        let symbols = f.symbols.take();
        let symbols = symbols.map(|s| std::rc::Rc::new(s));
        for case in &f.cases {
            let idx = symbols.clone();
            let facts: Facts = compute_facts(&f.gathered, &case.reputation, move || {
                idx.map(|s| Box::new(Shared(s)) as Box<dyn SymbolIndex>)
            });
            let ours = serde_json::to_value(&facts).unwrap();
            assert_eq!(ours, case.facts, "{} ({}) facts differ", f.url, case.reputation);

            let request = request_for("z-ai/glm-5.3-flash", &f.gathered, &facts);
            assert!(request == case.request_body, "{} ({}) request bytes differ {}", f.url, case.reputation, first_difference(&request, &case.request_body));

            let input = Input {
                repo_id: f.repo_id,
                number: f.gathered.contribution.number,
                github_user: f.gathered.author.clone(),
                reputation: case.reputation.clone(),
                threshold_bps: 8500,
                model: "z-ai/glm-5.3-flash".into(),
                record_url: None,
                ..Default::default()
            };
            for d in &case.decisions {
                let j = decide(&input, &f.gathered, facts.clone(), &d.response_body, &case.signed_text);
                assert_eq!(serde_json::to_value(&j.final_).unwrap(), d.final_, "{} ({}) final verdict differs", f.url, case.reputation);
                assert_eq!(j.verdict_hash, d.verdict_hash, "{} verdict hash differs", f.url);
                checked += 1;
            }
        }
    }
    assert!(checked > 300);
}

struct Shared(std::rc::Rc<Symbols>);
impl SymbolIndex for Shared {
    fn has(&self, id: &str) -> bool {
        self.0.has(id)
    }
    fn namespace_size(&self, ns: &str) -> usize {
        self.0.namespace_size(ns)
    }
}
