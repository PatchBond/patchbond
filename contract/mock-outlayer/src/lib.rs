//! Test-only stand-in for OutLayer: `request_execution` returns whatever answer the test scripted,
//! the way `outlayer.near` returns the enclave program's JSON (or `null` for a failed run).
//! Never deploy this anywhere real.

use near_sdk::serde_json::Value;
use near_sdk::{env, near, Gas, GasWeight, NearToken};

#[near(contract_state)]
#[derive(Default)]
pub struct MockOutlayer {
    /// The JSON to hand back; "PANIC" makes `request_execution` refuse the call.
    answer: String,
    last_args: String,
    last_deposit: NearToken,
    /// Deferred mode: `request_execution` yields like the real `outlayer.near`, and the answer
    /// arrives only when the test calls `resume` — so other transactions can land in between.
    deferred: bool,
    pending: Vec<u8>,
}

#[near]
impl MockOutlayer {
    pub fn set_answer(&mut self, answer: String) {
        self.answer = answer;
    }

    pub fn set_deferred(&mut self, deferred: bool) {
        self.deferred = deferred;
    }

    /// Deliver the answer to the run waiting in deferred mode.
    pub fn resume(&mut self, answer: String) {
        let id: [u8; 32] = std::mem::take(&mut self.pending).try_into().unwrap_or_else(|_| env::panic_str("nothing is waiting"));
        near_sdk::require!(env::promise_yield_resume(&id, answer.as_bytes()), "the waiting run is gone");
    }

    pub fn waiting(&self) -> bool {
        !self.pending.is_empty()
    }

    #[private]
    pub fn on_resume(&mut self) {
        match env::promise_result_checked(0, 16_384) {
            Ok(bytes) => env::value_return(&bytes),
            Err(_) => env::panic_str("timed out (mock)"),
        }
    }

    #[payable]
    pub fn request_execution(
        &mut self,
        source: Value,
        resource_limits: Option<Value>,
        input_data: Option<String>,
        secrets_ref: Option<Value>,
        response_format: Option<Value>,
        payer_account_id: Option<String>,
    ) {
        if self.answer == "PANIC" {
            env::panic_str("Insufficient payment (mock)");
        }
        self.last_args = near_sdk::serde_json::json!({
            "source": source, "resource_limits": resource_limits, "input_data": input_data,
            "secrets_ref": secrets_ref, "response_format": response_format, "payer_account_id": payer_account_id,
        })
        .to_string();
        self.last_deposit = env::attached_deposit();
        if self.deferred {
            let idx = env::promise_yield_create("on_resume", [], Gas::from_tgas(20), GasWeight(0), 0);
            self.pending = env::read_register(0).expect("yield id");
            env::promise_return(idx);
            return;
        }
        env::value_return(self.answer.as_bytes());
    }

    pub fn last_request(&self) -> (String, NearToken) {
        (self.last_args.clone(), self.last_deposit)
    }
}
