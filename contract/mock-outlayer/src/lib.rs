//! Test-only stand-in for OutLayer: `request_execution` returns whatever answer the test scripted,
//! the way `outlayer.near` returns the enclave program's JSON (or `null` for a failed run).
//! Never deploy this anywhere real.

use near_sdk::serde_json::Value;
use near_sdk::{env, near, NearToken};

#[near(contract_state)]
#[derive(Default)]
pub struct MockOutlayer {
    /// The JSON to hand back; "PANIC" makes `request_execution` refuse the call.
    answer: String,
    last_args: String,
    last_deposit: NearToken,
}

#[near]
impl MockOutlayer {
    pub fn set_answer(&mut self, answer: String) {
        self.answer = answer;
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
        env::value_return(self.answer.as_bytes());
    }

    pub fn last_request(&self) -> (String, NearToken) {
        (self.last_args.clone(), self.last_deposit)
    }
}
