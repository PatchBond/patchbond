//! A disputed verdict is re-judged in the enclave with the challenge block and both sides' on-chain
//! statements. The request must be byte-identical to the server's re-judge request for the same PR
//! (`server/src/judge/prompt.ts`), including escaped tags, Unicode and the 2,000-character cut.
//! Fixtures: `server/scripts/make-rejudge-fixture.ts`.

use patchbond_judge::facts::Facts;
use patchbond_judge::prompt::{Challenge, Statement};
use patchbond_judge::{rejudge_request_for, Gathered, Input};
use serde::Deserialize;

#[derive(Deserialize)]
struct Case {
    reputation: String,
    facts: Facts,
}
#[derive(Deserialize)]
struct Parity {
    gathered: Gathered,
    cases: Vec<Case>,
}
#[derive(Deserialize)]
struct ChallengeJson {
    proposed: String,
    challenger: String,
    statements: Vec<Statement>,
}
#[derive(Deserialize)]
struct Rejudge {
    fixture: usize,
    challenge: ChallengeJson,
    request_body: String,
}

#[test]
fn the_enclave_rejudge_request_matches_the_server_byte_for_byte() {
    let parity: Vec<Parity> = serde_json::from_str(include_str!("fixtures/parity.json")).unwrap();
    let cases: Vec<Rejudge> = serde_json::from_str(include_str!("fixtures/rejudge.json")).unwrap();
    assert_eq!(cases.len(), 3);
    for c in cases {
        let p = &parity[c.fixture];
        let facts = &p.cases.iter().find(|x| x.reputation == "new").unwrap().facts;
        // The contract's input for a re-judge, as rejudge_in_tee builds it.
        let input = Input {
            mode: "rejudge".into(),
            proposed: c.challenge.proposed,
            challenger: c.challenge.challenger,
            statements: c.challenge.statements,
            model: "moonshotai/kimi-k3".into(),
            ..Default::default()
        };
        let challenge: Option<Challenge> = input.challenge();
        let ours = rejudge_request_for(&input.model, &p.gathered, facts, challenge.as_ref());
        assert!(ours == c.request_body, "fixture {}: re-judge request differs", c.fixture);
    }
    // A first judgment has no challenge block.
    assert!(Input::default().challenge().is_none());
}
