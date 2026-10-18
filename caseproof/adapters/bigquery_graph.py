"""Temporal observed graph over bounded bank records; exact allocation remains code."""

from caseproof.domain.ledger import dt
from caseproof.graph.contracts import Account, ComplaintLink, Identifier, Transfer


class BigQueryGraph:
    def __init__(self, bank):
        self.bank = bank

    def apply(self, updates):
        if updates:
            raise ValueError("Cloud observations must arrive through immutable bank ingestion")

    def read(self, as_of):
        accounts, transfers, observed = {}, {}, {}

        def account(raw):
            item = Account.model_validate(raw)
            if item.id in accounts and accounts[item.id] != item:
                raise ValueError("conflicting account identity")
            accounts[item.id] = item

        def edge(raw):
            item = Transfer.model_validate(raw)
            if dt(item.ts) > dt(as_of):
                return
            if item.txn_id in transfers and transfers[item.txn_id] != item:
                raise ValueError("conflicting transfer source")
            transfers[item.txn_id] = item
            for aid in (item.from_account, item.to_account):
                if aid not in accounts:
                    accounts[aid] = Account(
                        id=aid,
                        bank="Bank not yet reported",
                        label=aid,
                        kind="cashout"
                        if aid == item.to_account
                        and item.channel.upper() in {"ATM", "CRYPTO", "EXTERNAL"}
                        else "layer",
                    )

        for batch in self.bank.batches(as_of):
            for raw in batch["accounts"]:
                account(raw)
            for tx in batch["transactions"]:
                if not any(
                    c["account"] == tx["account"]
                    and dt(c["as_of"]) <= dt(as_of)
                    and dt(c["start"]) <= dt(tx["ts"]) <= dt(c["end"])
                    for c in batch["coverage"]
                ):
                    continue
                edge(
                    {
                        "txn_id": tx["txn_id"],
                        "ts": tx["ts"],
                        "from_account": tx["account"],
                        "to_account": tx["counterparty_account"],
                        "amount_minor": tx["amount_minor"],
                        "channel": tx["channel"],
                        "reference": tx["reference"],
                        "source": "ledger",
                    }
                )
        # Refresh reports carry only a balance; keep the latest per account plus every
        # report that carries transfers, so a long session stays under the row limit.
        reports = self.bank.client.query(
            f"WITH r AS (SELECT id, payload, reported_at "
            f"FROM {self.bank.client.table('downstream_reports')} "
            "WHERE tenant=@tenant AND reported_at<=TIMESTAMP(@as_of) "
            "AND received_at<=TIMESTAMP(@as_of) "
            "QUALIFY ROW_NUMBER() OVER(PARTITION BY id ORDER BY received_at)=1) "
            "SELECT payload FROM r WHERE TRUE QUALIFY STRPOS(id, '-REFRESH-')=0 "
            "OR ROW_NUMBER() OVER(PARTITION BY JSON_VALUE(payload, '$.account'), "
            "STRPOS(id, '-REFRESH-')>0 ORDER BY reported_at DESC, id DESC)=1",
            {"tenant": self.bank.tenant, "as_of": as_of},
        )
        for report in sorted(reports, key=lambda r: (dt(r["reported_at"]), r["update_id"])):
            aid = report["account"]
            if aid in accounts and accounts[aid].bank not in {
                "Bank not yet reported",
                report["reporting_bank"],
            }:
                raise ValueError("reporting bank mismatch")
            for raw in report.get("accounts", []):
                account(raw)
            for raw in report["credit_received"] + report["onward_transfers"]:
                edge(raw)
            observed[aid] = report
        complaint_rows = self.bank.client.query(
            f"SELECT payload FROM {self.bank.client.table('complaints')} "
            "WHERE tenant=@tenant AND received_at<=TIMESTAMP(@as_of) "
            "QUALIFY ROW_NUMBER() OVER(PARTITION BY JSON_VALUE(payload,'$.complaint_id') "
            "ORDER BY received_at DESC)=1",
            {"tenant": self.bank.tenant, "as_of": as_of},
        )
        links, identifiers = {}, []
        for row in sorted(complaint_rows, key=lambda r: (dt(r["reported_at"]), r["complaint_id"])):
            if dt(row["reported_at"]) > dt(as_of):
                continue
            for raw in row["links"]:
                link = ComplaintLink.model_validate(raw)
                if link.txn_id in transfers and dt(link.reported_at) <= dt(as_of):
                    links.setdefault((link.victim, link.txn_id), link)
            identifiers.extend(Identifier.model_validate(i) for i in row.get("identifiers", []))
        return (
            list(accounts.values()),
            list(transfers.values()),
            list(links.values()),
            identifiers,
            observed,
        )
