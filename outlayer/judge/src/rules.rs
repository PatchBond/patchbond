//! Port of `server/src/judge/rules.ts` (rules the model can't override) and of the model-answer
//! parsing (`modelContent` + the strict `ModelVerdict` schema in `shared/src/types.ts`).

use serde::Serialize;
use serde_json::Value;

use crate::facts::{Facts, RepoRules};
use crate::js;

#[derive(Clone, Debug, Serialize, PartialEq)]
pub struct Evidence {
    pub file: String,
    pub line: Option<u64>,
    pub note: String,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
pub struct ModelVerdict {
    pub verdict: String,
    #[serde(serialize_with = "crate::facts::js_number")]
    pub confidence: f64,
    pub category: String,
    pub reasons: Vec<String>,
    pub evidence: Vec<Evidence>,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
pub struct Final {
    pub verdict: String,
    #[serde(serialize_with = "crate::facts::js_number")]
    pub confidence: f64,
    pub category: String,
    pub reasons: Vec<String>,
    pub evidence: Vec<Evidence>,
    pub rules_applied: Vec<String>,
}

pub const REFUND_CONFIDENCE: f64 = 0.8;
const CATEGORIES: [&str; 9] = ["ok", "does_not_work", "phantom_code", "duplicate", "off_topic", "boilerplate", "policy", "injection", "malicious"];

/// `stripFences` from `shared/src/verify.ts`.
fn strip_fences(s: &str) -> String {
    let t = js::trim(s);
    let fenced = js::re(r"^```(?:json)?\s*([\s\S]*?)\s*```$", "");
    js::first(&fenced, t, 1).unwrap_or_else(|| t.to_string())
}

/// The model's answer from the exact response bytes, or None if it breaks the schema.
pub fn model_verdict(response_body: &str) -> Option<ModelVerdict> {
    let resp: Value = serde_json::from_str(response_body).ok()?;
    let content = match &resp["choices"][0]["message"]["content"] {
        Value::String(s) => s.clone(),
        Value::Null => "null".into(),
        other => other.to_string(),
    };
    let v: Value = serde_json::from_str(&strip_fences(&content)).ok()?;
    let o = v.as_object()?;
    // `.strict()`: no keys beyond these five.
    if o.keys().any(|k| !["verdict", "confidence", "category", "reasons", "evidence"].contains(&k.as_str())) {
        return None;
    }
    let verdict = o.get("verdict")?.as_str().filter(|v| ["refund", "forfeit", "needs_human"].contains(v))?;
    let confidence = o.get("confidence")?.as_f64().filter(|c| (0.0..=1.0).contains(c))?;
    let category = o.get("category")?.as_str().filter(|c| CATEGORIES.contains(c))?;
    let reasons = o.get("reasons")?.as_array().filter(|a| a.len() <= 5)?;
    let reasons: Vec<String> = reasons.iter().map(|r| r.as_str().filter(|s| js::len16(s) <= 400).map(String::from)).collect::<Option<_>>()?;
    let evidence = o.get("evidence")?.as_array().filter(|a| a.len() <= 10)?;
    let evidence = evidence
        .iter()
        .map(|e| {
            let e = e.as_object()?;
            let file = e.get("file")?.as_str().filter(|s| js::len16(s) <= 300)?;
            let note = e.get("note")?.as_str().filter(|s| js::len16(s) <= 400)?;
            let line = match e.get("line") {
                None | Some(Value::Null) => None,
                Some(n) => Some(n.as_u64().or_else(|| n.as_f64().filter(|f| f.fract() == 0.0 && *f >= 0.0).map(|f| f as u64))?),
            };
            Some(Evidence { file: file.into(), line, note: note.into() })
        })
        .collect::<Option<Vec<_>>>()?;
    Some(ModelVerdict { verdict: verdict.into(), confidence, category: category.into(), reasons, evidence })
}

fn high(facts: &Facts) -> Vec<&crate::malice::Finding> {
    facts.malicious.iter().filter(|f| f.severity == "high").collect()
}

/// Hard facts the program established itself. Without one, the model can't forfeit on its own.
pub fn hard_facts(facts: &Facts, rules: &RepoRules) -> Vec<&'static str> {
    let mut out = vec![];
    if facts.ci == "failure" {
        out.push("failing CI");
    }
    if !facts.phantom_symbols.is_empty() {
        out.push("phantom code");
    }
    if facts.duplicate_of.is_some() {
        out.push("duplicate");
    }
    if !facts.injection_markers.is_empty() {
        out.push("prompt injection");
    }
    if !facts.unbacked_claims.is_empty() {
        out.push("claims not in the diff");
    }
    if !high(facts).is_empty() {
        out.push("malicious code");
    }
    if facts.files_changed == 0 || facts.additions + facts.deletions == 0 {
        out.push("empty change");
    }
    if rules.unassigned_effect == "evidence" && (facts.assignment == "assigned_to_other" || facts.assignment == "unassigned") {
        out.push("issue not assigned to the author");
    }
    out
}

/// JS `String(n)` for the numbers that appear in rule messages.
fn num(n: f64) -> String {
    if n.fract() == 0.0 { format!("{}", n as i64) } else { format!("{n}") }
}

pub fn apply_rules(model: Option<&ModelVerdict>, facts: &Facts, threshold: f64, rules: &RepoRules) -> Final {
    let Some(model) = model else {
        return Final {
            verdict: "needs_human".into(),
            confidence: 0.0,
            category: "ok".into(),
            reasons: vec!["The judge's answer wasn't valid; a maintainer decides.".into()],
            evidence: vec![],
            rules_applied: vec!["Invalid model output → needs_human".into()],
        };
    };
    let mut applied: Vec<String> = vec![];
    let mut verdict = model.verdict.clone();
    let mut confidence = model.confidence;
    let mut category = model.category.clone();
    let mut reasons = model.reasons.clone();
    let mut evidence = model.evidence.clone();

    if verdict == "forfeit" {
        if model.confidence < threshold {
            verdict = "needs_human".into();
            applied.push(format!("Confidence {} is below the repo's forfeit threshold {} → needs_human", num(model.confidence), num(threshold)));
        } else if model.evidence.is_empty() {
            verdict = "needs_human".into();
            applied.push("A forfeit needs at least one concrete piece of evidence → needs_human".into());
        } else if hard_facts(facts, rules).is_empty() {
            verdict = "needs_human".into();
            applied.push("No hard fact (failing CI, phantom code, duplicate, injection, malicious code, claims missing from the diff, an empty change, or an issue assigned to someone else) → the model can't forfeit on its own → needs_human".into());
        } else if facts.author_reputation == "proven" {
            verdict = "needs_human".into();
            applied.push("Proven contributor (prior refunds, no forfeits) → a forfeit goes to a human".into());
        }
    }
    if verdict == "refund" && facts.ci == "failure" {
        verdict = "needs_human".into();
        let first3: Vec<&str> = facts.ci_failed_checks.iter().take(3).map(String::as_str).collect();
        applied.push(format!("CI is failing ({}) → a refund isn't automatic; a maintainer decides", first3.join(", ")));
    } else if verdict == "refund" && confidence < REFUND_CONFIDENCE {
        verdict = "needs_human".into();
        applied.push(format!("Refund confidence {} is below {} → a maintainer decides", num(confidence), num(REFUND_CONFIDENCE)));
    }

    let high = high(facts);
    let medium: Vec<_> = facts.malicious.iter().filter(|f| f.severity == "medium").collect();
    if !high.is_empty() && verdict != "forfeit" {
        if facts.author_reputation == "proven" {
            verdict = "needs_human".into();
            applied.push(format!("Malicious pattern ({}) from a proven contributor → a human decides", high[0].rule));
        } else {
            verdict = "forfeit".into();
            confidence = confidence.max(0.9);
            category = "malicious".into();
            let what: Vec<String> = high.iter().map(|f| format!("{} in {}", f.rule, f.file)).collect();
            reasons.insert(0, format!("Malicious code: {}.", what.join("; ")));
            reasons.truncate(5);
            let mut ev: Vec<Evidence> = high.iter().map(|f| Evidence { file: f.file.clone(), line: None, note: format!("{}: {}", f.rule, f.excerpt) }).collect();
            ev.extend(evidence);
            ev.truncate(10);
            evidence = ev;
            let ids: Vec<&str> = high.iter().map(|f| f.rule.as_str()).collect();
            applied.push(format!("Malicious pattern found by the server's scan ({}) → forfeit proposed; the contributor can challenge it", ids.join(", ")));
        }
    } else if !medium.is_empty() && verdict == "refund" {
        verdict = "needs_human".into();
        let ids: Vec<&str> = medium.iter().map(|f| f.rule.as_str()).collect();
        applied.push(format!("Risky change ({}) → a human looks before the bond is refunded", ids.join(", ")));
    }
    Final { verdict, confidence, category, reasons, evidence, rules_applied: applied }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::facts::{Facts, DEFAULT_RULES};

    fn facts(files: u64, add: u64) -> Facts {
        Facts {
            ci: "success".into(), ci_failed_checks: vec![], phantom_symbols: vec![], unresolved_symbols: vec![], duplicate_of: None, issue: None,
            assignment: "no_issue".into(), unbacked_claims: vec![], files_changed: files, additions: add, deletions: 0, injection_markers: vec![],
            malicious: vec![], author_reputation: "new".into(),
        }
    }

    #[test]
    fn an_empty_change_is_a_hard_fact() {
        // First live case (CivicLedger #60): an empty PR claiming to fix an issue.
        let model = ModelVerdict { verdict: "forfeit".into(), confidence: 0.95, category: "does_not_work".into(), reasons: vec!["empty".into()], evidence: vec![Evidence { file: "(diff)".into(), line: None, note: "empty".into() }] };
        assert_eq!(apply_rules(Some(&model), &facts(0, 0), 0.85, &DEFAULT_RULES).verdict, "forfeit");
        assert_eq!(apply_rules(Some(&model), &facts(1, 3), 0.85, &DEFAULT_RULES).verdict, "needs_human");
    }
}
