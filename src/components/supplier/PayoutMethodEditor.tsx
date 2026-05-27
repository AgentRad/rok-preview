import SupplierStripeConnect from "@/components/SupplierStripeConnect";
import SupplierBankInfo from "@/components/SupplierBankInfo";
import type { snapshotConnect } from "@/lib/stripe-connect";

type ConnectSnap = ReturnType<typeof snapshotConnect>;

// PLH-3l P2: extracted from /supplier/page.tsx Payout method card.
export default function PayoutMethodEditor({
  connectSnap,
  successFlag,
  refreshFlag,
  legacyBank,
}: {
  connectSnap: ConnectSnap;
  successFlag: boolean;
  refreshFlag: boolean;
  legacyBank: {
    show: boolean;
    bankInfoStatus: string;
    bankInfoLast4: string | null;
    bankInfoType: string | null;
    bankInfoBankName: string | null;
    bankInfoNote: string;
    bankInfoUpdatedAt: string | null;
  };
}) {
  return (
    <div id="bank-info" className="card">
      <div className="card-head">
        <h2>Payout method</h2>
      </div>
      <div className="card-body">
        <SupplierStripeConnect
          initial={{
            configured: connectSnap.configured,
            accountId: connectSnap.accountId,
            chargesEnabled: connectSnap.chargesEnabled,
            payoutsEnabled: connectSnap.payoutsEnabled,
            active: connectSnap.active,
            pending: connectSnap.pending,
          }}
          successFlag={successFlag}
          refreshFlag={refreshFlag}
        />
        {legacyBank.show && (
          <details
            style={{
              marginTop: 18,
              paddingTop: 14,
              borderTop: "1px solid var(--line)",
            }}
          >
            <summary
              className="muted-text"
              style={{ fontSize: 12.5, cursor: "pointer" }}
            >
              Legacy bank info (pre-Stripe Connect)
            </summary>
            <div style={{ marginTop: 12 }}>
              <SupplierBankInfo
                initial={{
                  bankInfoStatus: legacyBank.bankInfoStatus,
                  bankInfoLast4: legacyBank.bankInfoLast4,
                  bankInfoType: legacyBank.bankInfoType,
                  bankInfoBankName: legacyBank.bankInfoBankName,
                  bankInfoNote: legacyBank.bankInfoNote,
                  bankInfoUpdatedAt: legacyBank.bankInfoUpdatedAt,
                }}
              />
            </div>
          </details>
        )}
      </div>
    </div>
  );
}
