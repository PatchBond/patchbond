// Records the OutLayer enclave publishes (outlayer/judge → POST /api/tee-records). The enclave posts
// before the contract's callback has run, so a record is held until the contract's own job says
// "judged" with this record's verdict hash — then it's published like any verdict. Anyone can post
// here; a record only goes public if it checks out byte for byte and the chain agrees.

import { verifyRecord, type VerdictRecord } from "@patchbond/shared";
import type { Chain } from "./near";
import type { Store } from "./store";

const HOLD_MS = 15 * 60_000;
const MAX_PENDING = 200;

export class TeeRecords {
  private pending = new Map<string, { record: VerdictRecord; at: number }>();

  constructor(
    private chain: Pick<Chain, "getTeeSigners" | "getTeeJob">,
    private store: Store,
    /** Called once a record is confirmed on-chain and saved. */
    private onConfirmed: (r: VerdictRecord) => void = () => {},
    private pollMs = 10_000,
  ) {}

  /** Checks a posted record; holds it until the chain confirms it. Returns why it was refused. */
  async accept(raw: unknown): Promise<string | null> {
    const r = raw as VerdictRecord;
    if (!r || typeof r !== "object" || r.runner !== "outlayer-tdx" || typeof r.verdict_hash !== "string" || !r.signature?.text) {
      return "Not an OutLayer verdict record";
    }
    const failed = (await verifyRecord(r)).filter((c) => !c.ok);
    if (failed.length) return `Record doesn't verify: ${failed.map((c) => c.name).join("; ")}`;
    // The contract lists keys as "0x<address>"; gateway keys ("0x…@model") never count here, as in
    // the contract's own callback check.
    const bare = (a: string) => a.toLowerCase().replace(/^0x/, "");
    const signers = ((await this.chain.getTeeSigners()) ?? []).filter((a) => !a.includes("@")).map(bare);
    if (!signers.includes(bare(r.signature.signing_address))) {
      return `0x${r.signature.signing_address} isn't a NEAR AI key this contract trusts`;
    }
    this.prune();
    this.pending.set(r.verdict_hash, { record: { ...r, mock: false }, at: Date.now() });
    void this.confirmLater(r.repo.id, r.number);
    return null;
  }

  /** The confirmed record for a judged job, saving it the first time. */
  async confirmed(repoId: number, number: number): Promise<VerdictRecord | null> {
    const job = await this.chain.getTeeJob(repoId, number);
    if (job?.state !== "judged" || !job.verdict_hash) return null;
    const saved = this.store.verdict(job.verdict_hash.slice(0, 16));
    if (saved) return saved;
    const held = this.pending.get(job.verdict_hash);
    if (!held) return null;
    this.store.saveVerdict(held.record);
    this.pending.delete(job.verdict_hash);
    this.onConfirmed(held.record);
    return held.record;
  }

  /** The enclave's run finishes ~seconds after it posts; check the chain for a few minutes. */
  private async confirmLater(repoId: number, number: number) {
    for (let i = 0; i < (5 * 60_000) / this.pollMs; i++) {
      await Bun.sleep(this.pollMs);
      const job = await this.chain.getTeeJob(repoId, number).catch(() => undefined);
      if (job === null) return; // not judged (failed/waiting) — the record never goes public
      if (job?.state === "judged") {
        await this.confirmed(repoId, number);
        return;
      }
    }
  }

  private prune() {
    const now = Date.now();
    for (const [k, v] of this.pending) if (now - v.at > HOLD_MS) this.pending.delete(k);
    while (this.pending.size >= MAX_PENDING) this.pending.delete(this.pending.keys().next().value!);
  }
}
