# Architecture Decision Records

Industry-standard format (Michael Nygard): Title, Status, Context, Decision,
Consequences, Alternatives Considered.

Every record here has status **PROPOSED**. Nothing is accepted until the owner
approves it. A record that the owner rejects stays in the index marked
**REJECTED** — rejected reasoning is still reasoning.

## Index

| ID | Title | Status |
|----|-------|--------|
| [0001](0001-pin-proof-over-argon2-at-edge.md) | HMAC PIN proof verified at the edge instead of argon2id | PROPOSED |
| [0002](0002-pin-pepper-as-proof-key.md) | Proof keys off `PIN_PEPPER \|\| GATEWAY_SHARED_SECRET` on both sides | PROPOSED |
| [0003](0003-single-day-and-range-share-roster-read.md) | Single-day and range attendance reads share `readAttendanceRoster` | PROPOSED |
| [0004](0004-gitleaks-hard-gate-with-history-scan.md) | Gitleaks hard gate over full history, red until rotation | PROPOSED |
| [0005](0005-coderabbit-action-disabled-not-pinned.md) | Dead `coderabbitai/ai-pr-reviewer` reference disabled, not pinned | PROPOSED |
