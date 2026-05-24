# PartsPort: Strategy Context

Companion to `LAUNCH_PLAN.md`. The launch plan says *what* to build. This says *why* every decision was made the way it was. Read it when you need to make a judgment call the build spec does not explicitly answer. Zero em dashes anywhere in this file or in any site copy.

---

## 1. The vision and the thesis

PartsPort is a transactional online marketplace for industrial parts and equipment. The thesis: industrial distribution is a huge, fragmented market where buyers (utilities, co-ops, contractors, municipals, EPCs) source parts through a slow, opaque, relationship-bound process. Calling several distributors, waiting on quotes, hoping a part is genuine. PartsPort collapses that into one platform that handles discovery, vetting, payment, and delivery, and earns a small fee on each transaction.

Starting vertical: energy and utilities (transformers, switchgear, protective relays, conductors, metering, generators, solar, storage, grounding, SCADA). The catalog is category-agnostic and built to expand to other industrial verticals like Amazon expanded beyond books.

Product philosophy: businesses keep doing their normal work (supplier supplies parts, buyer buys what they need). They just input the right information, and PartsPort gets the rest done. That principle drives every category decision below.

---

## 2. The three parties

Cleanly separate. The model only works when this distinction stays sharp.

**Manufacturers (OEMs)** design and build the equipment (Siemens, ABB, Eaton, S&C, and so on). On PartsPort they participate **free** forever. They get a branded storefront with their specs, datasheets, and price ranges, plus demand intelligence (what buyers search for and where). They **never sell direct** on the platform. Every sale routes to one of their own authorized distributors. The whole reason OEMs join is that PartsPort delivers a free demand channel that protects the channel they already built.

**Distributors (suppliers)** stock and sell the equipment. They are the merchants of record on PartsPort. They list products, fulfill orders, and pay the transaction fee (5 to 6 percent). They are the ones who get the verified-supplier badge, accumulate reviews, and receive payouts.

**Buyers** (utilities, co-ops, municipals, contractors, EPCs) need the equipment. They search, compare, order, and pay.

Quick way to keep it straight: **OEM builds it, supplier sells it, buyer needs it.** "Supplier" everywhere in this document means *distributor*, never OEM.

---

## 3. The nine categories of the platform, in full depth

### Category 1: Catalog & Search

**How it works.** Every product, from every vetted supplier, in one searchable catalog. Each listing carries name, manufacturer, category, SKU, price, unit, lead time, stock level, description, specs, and a photo (with a line-art fallback). Every listing references both the **manufacturer** (the OEM brand, for example Siemens) and the **supplier** (the distributor who sells and ships it).

Buyers find parts two ways. **Browse**: the catalog page with category filters, in-stock filter, and sort by price, ETA, or rating. **Search**: a search bar that accepts part numbers, descriptions, or plain-language problems like "I need to replace a 500 kVA pad-mount transformer." The AI search reads the entire catalog and returns parts that genuinely fit, understanding intent, synonyms, applications, and specs. A heuristic keyword search is the fallback when AI is off. The landing page itself is a live search box, so a buyer starts searching the second they arrive.

**What problem it solves.** Today, sourcing one part means several phone calls, waiting on quotes, opaque pricing, and no way to verify a supplier is legitimate. Distributors live with feast-or-famine demand and chase marketing leads. The catalog plus search collapses both problems: every vetted supplier in one place, instantly searchable and comparable.

**How users rate it.** Buyers get the "wow" moment: a multi-day chore becomes a search. Suppliers get qualified demand the moment they list, with no marketing spend. The catalog depth determines the experience. A thin catalog with wrong prices instantly becomes useless. The software does its job. The catalog liquidity is what your supplier network must fill.

**Critical nuance: OEMs do not transact, but their parts are heavily purchased.** A buyer can buy a Siemens transformer today on PartsPort. The listing shows "Siemens" as the manufacturer; the distributor is the seller. So OEM products sell, OEMs get full demand visibility, and PartsPort earns the fee, without the OEM ever being the merchant. That preserves zero channel conflict and is structurally better for everyone than OEM-direct sales.

**Future: gated wholesale tier.** Eventually a second tier where vetted distributors can purchase wholesale from OEMs, hidden from end buyers. Real model (Faire works this way). Not built now, because (a) it breaks the OEM no-channel-conflict promise if done badly, (b) wholesale pricing is contract-confidential, (c) the OEM-to-distributor relationship is already efficient via EDI, and (d) it is its own cold-start. The permissions model is designed so it can be gated per-OEM (only Brand X's authorized distributors access Brand X wholesale) later, without a rebuild. Brand names on the retail catalog always stay public.

---

### Category 2: Buying

Two lanes, automatically chosen by the platform per product. The buyer never has to decide.

**Instant checkout** for in-stock items with a fixed price. Buyer sees "Add to cart." Standard cart, ship-to, pay, done. Amazon-style. Used for stocked commodity parts where the buyer knows what they want and wants it now.

**RFQ (Request a Quote)** for big configured equipment (typically over about $3,000). Buyer sees "Request a quote" instead of "Add to cart." Flow:
1. Buyer submits qty, message, company.
2. Request lands with the right supplier in their dashboard.
3. Supplier responds with quoted price and note.
4. Buyer accepts or lets go.
5. On accept, the quote **becomes a real on-platform order**. Payment and delivery still run through PartsPort, and the fee still settles here.

The "becomes an order" step is the strategic move. It ensures the fee, payment, and delivery still settle on PartsPort even for the largest deals.

**What each lane solves.** Instant lane: today even buying a $200 stocked part means calling a distributor and waiting on a quote. Absurd for a stocked commodity. RFQ lane: configured equipment genuinely cannot have a fixed price (depends on spec, freight, lead time), and today it lives in scattered email threads for weeks. Without the RFQ lane, all big-ticket business would happen off-platform and PartsPort would lose the fee on its largest transactions.

**How users rate it.** Buyer: the instant lane is the everyday "wow"; the RFQ lane is the bigger emotional win because it removes anxiety from a high-stakes purchase. Supplier: instant orders just arrive; RFQs arrive structured and easy to respond to. The quiet UX win is that the buyer never chooses the lane.

**Honest caveat.** The RFQ lane is only as good as supplier response speed. A four-day quote turnaround makes the new system feel like the old broken one. Suppliers need an SLA on response time. The software structures the request; the supplier still has to answer it fast.

---

### Category 3: Payments & Pricing

**Money flow.** Buyer pays the platform, never the supplier directly. PartsPort holds the funds, takes its fee, and pays the supplier on dispatch (on cleared funds).

**What the buyer pays = four components** (this is critical):
- **Subtotal** (the part price the supplier set)
- **+ Freight** (real shipping cost, material on heavy equipment)
- **+ Platform fee** (5 to 6 percent)
- **+ Sales tax** (where applicable; many utility buyers are tax-exempt)
- **= Total charged to the buyer**

Where each goes: supplier gets the full subtotal, carrier gets freight, state gets tax, PartsPort keeps the fee.

**Take rate, honestly.** 4 percent is too thin once payment processing is subtracted (Stripe roughly 2.9 percent on cards). Recommended 5 to 6 percent. The rate is a single config value, never hardcoded.

**The real margin lever is the payment rail, not the processor.** Card interchange (roughly 1.5 to 2.5 percent) is set by Visa/Mastercard, and every processor pays it. Switching processors saves only the markup. The big lever is pushing payments to bank rails:
- **ACH bank transfer**: roughly 0.5 to 0.8 percent
- **Wire transfer**: small flat fee, basically 0 percent on a $100k order
- **Card**: roughly 2.9 percent

B2B orders are large, so **ACH is the default rail and wire is for the biggest orders**. Card is secondary. This is where margin lives, regardless of which processor.

**Sales tax is pass-through, never revenue.** Collected from the buyer (Stripe Tax or equivalent computes by ship-to and item), remitted to the state. Tax-exempt buyers (many co-ops and municipals are) upload a certificate once and are not charged.

**Processor: keep it swappable.** Stripe is the easy default but not sacred. Build payments behind an abstraction so the processor is swappable without touching the rest of the app. Launch on whatever is fastest; negotiate or switch when GMV gives leverage. Whatever processor: it must support marketplace split payouts, KYC payees, strong ACH, PCI compliance, and (most important) financial stability. Don't trade reliability for 0.2 percent. You're holding other people's money.

**Payment-state-gated lifecycle.** Nothing dispatches and no supplier payout happens until funds are **cleared/settled**, not just submitted. ACH can be returned days after it appears to have succeeded; wire is final on receipt. For large orders, require wire.

**Future: net terms / trade credit.** A Phase 2 feature. PartsPort offers buyers "pay in 30 to 60 days" while still paying the supplier immediately, with the platform floating it. This is a powerful anti-disintermediation moat. A single supplier cannot easily offer that. It requires working capital. Build once volume justifies it.

---

### Category 4: Invoicing & Documents

**Documents the platform auto-generates as PDFs:**
- Invoice (for every paid order)
- RFQ quote (when a supplier responds, the quote is a real shareable document, not a buried email)
- Packing slip
- Bill of Lading (BOL) for LTL freight orders

**Documents the platform stores** (upload, not generate):
- Tax-exemption certificates
- Insurance certificates
- Supplier verification docs (business registration, ISO certs, authorized-distributor proof)
- OEM datasheets attached to products

**Data in and out via Excel/CSV:**
- Supplier bulk catalog upload
- Buyer BOM upload, matched to catalog
- Exports of orders, invoices, payouts (including QuickBooks-importable format)

**Consolidated invoicing**: one invoice per buyer order even when items span multiple suppliers. The buyer never reconciles five invoices for one order.

**What it solves.** Today, B2B parts documentation is a mess: invoices in inconsistent formats by email, quotes lost in email threads, certs emailed around. PartsPort makes every document automatic, consistent, branded, and tied to the transaction in one place. This is also the "businesses do the same work, just input information, we get it done" vision in concrete form.

**AI import assistant** (Phase 2 polish, not launch-critical). A **bounded, guided** assistant helps a supplier map a messy spreadsheet to the PartsPort schema and resolve ambiguities conversationally. Not an open-ended chatbot. **Human review and explicit approval before anything goes live**. The AI never silently changes a price or spec. Same pattern on buyer BOM uploads.

**Progressive onboarding.** Collect the minimum to start; require the full profile (tax ID, banking, insurance, W-9) before the first transaction or payout. Don't make the onboarding form so heavy it kills signup. Logos optional with a clean default; never block someone because they didn't upload a logo.

**Caveat.** Document accuracy depends on category 3 being right. Wrong tax or freight on an invoice is worse than no invoice. Supplier spreadsheets are messy and inconsistent; the AI assistant handles a lot but won't be perfect on the first pass for every supplier.

---

### Category 5: Fulfillment & Delivery

**The asset-light orchestration model.** PartsPort does not own warehouses or trucks. The supplier physically ships from their existing warehouse (it's where the inventory already lives). PartsPort owns the orchestration: books and pays the freight, generates the label and BOL, owns the tracking, handles claims, is the single accountable point of contact.

This means "we handle shipping and delivery" is truthful. You handle the part the buyer cares about: one accountable partner, one invoice, tracking, someone to call when it goes wrong. You're not claiming to own trucks. This is "managed fulfillment", between FBM and FBA. You run the logistics layer on top of rented physical capacity (carriers, 3PLs).

**The ops console** (already built, basic) runs paid orders through New, Processing, Shipped, Delivered with carrier and tracking capture. Buyer sees the timeline.

**Heavy equipment realities.** Utility equipment ships **LTL freight** (pallets; transformers weigh hundreds to thousands of pounds), not parcel. LTL has real failure modes: damage, missed appointments, liftgate requirements, appointment delivery. Freight on heavy gear is **quoted within the RFQ lane**, not computed instantly at checkout. For parcel-shippable parts, an instant freight quote at checkout works.

**Damage and claims process.** Cannot be prevented; freight damage is real. The defense is an **evidence chain**:
- Supplier documents and photographs the item's condition before dispatch (serial number, condition record, factory test report where applicable).
- Buyer **inspects on delivery** and notes any damage on the freight delivery receipt **at the moment of delivery**. For LTL, this is legally critical. Signing "received in good condition" largely waives the claim.
- **Time-limited claim window**: buyer reports damage or defect within X hours of delivery with photos, or the claim closes.
- Freight insurance and carrier liability cover transit damage.

**How users rate it.** Buyer: the Amazon feeling. They see where the order is, real ETA, accountability. For high-stakes equipment, that visibility is a real relief. Supplier: logistics burden lifted. They pack, PartsPort does the rest. This is also one of the strongest **anti-disintermediation** moats. Walk off-platform and the supplier takes freight, tracking, and claims back onto their own plate.

**Caveats.** This is operationally the hardest category and the one most likely to go wrong. Doesn't scale until carrier APIs are integrated (concierge phase is for first ~20 orders). Freight margin is thin; price and book carefully. Depends on the business layer (carrier/broker accounts).

---

### Category 6: Money to Suppliers

**Flow.** Buyer pays. PartsPort collects. Order ships. A Payout record is created equal to that supplier's subtotal share. PartsPort pays the supplier by ACH on cleared funds. Each supplier sees a running payout statement (Due/Paid). Multi-supplier orders split per supplier.

**Accounting.** PartsPort's books track GMV, fee revenue, and payouts. CSV exports for the supplier's own accounting. QuickBooks-importable CSV bridges the gap until a full sync is built later.

**Tax reporting.** 1099 reporting on supplier payouts at year end. W-9 collected from suppliers at onboarding.

**The float.** The site promises suppliers are paid "on dispatch." A buyer's ACH can take days to fully clear. If PartsPort pays the supplier on dispatch before buyer funds settle, PartsPort is **floating** the money. Trivial at pilot scale. At volume, a real working-capital need. Early on, pay after clearance or after delivery; pay faster as capital allows. This is one of the things money genuinely unblocks.

**What it solves.** Cash flow is the number one pain in distribution. Today, distributors ship and wait 30, 60, or 90 days, carrying credit risk and chasing receivables. PartsPort kills both: supplier gets paid fast, in full, guaranteed, with no chasing and no risk. This is one of the strongest reasons a distributor joins at all.

**Caveats and risk.** Payout fraud (paying the wrong amount, paying a fraudulent "supplier"). Bank-account verification before first payout. **Re-verify any time payout bank details change** (classic redirect-fraud attack). Refunds and returns after a supplier's been paid need a clawback workflow. 1099 compliance is ongoing.

**How users rate it.** For suppliers, this is enormous. A transformational improvement to cash flow. It's a top reason they stay on-platform.

---

### Category 7: Communication

**Three layers, deliberately separated.**

**1. Transactional email** (automated, one-way): order confirmation, payment received, shipped (with tracking), delivered, RFQ received, quote ready, application status, password reset, payout sent. Notifications, not conversation.

**2. In-platform messaging, email-connected** (two-way): a thread tied to each RFQ and each order, between buyer and supplier, visible to admin. The thread shows in-app **and** reaches the other party as an email. Reply from your inbox, and the reply lands back in the thread (inbound email parsing). **One system serving both behaviors, not two.** This is the elegant answer to "email vs chat" because they're the same thing.

**3. In-app notifications center**: a logged-in user sees what needs attention (RFQ to quote, quote to review, order to fulfill).

**What it solves.** Today, communication around a parts purchase is scattered. RFQs in email threads, no shared record, the buyer chasing for status. PartsPort puts every message in one place, tied to its transaction, with proactive updates so the buyer never has to ask. PartsPort can see every thread and step in for support or mediation.

**Caveats.** Email deliverability matters; needs a proper email provider with a verified sending domain. Inbound email parsing (reply-by-email lands in thread) is real engineering, not trivial. Notification fatigue is real; tune what's sent. Be transparent that PartsPort can see messages (expected in B2B, but should be clear to users).

---

### Category 8: Trust & Verification

Two phases: a **gate** upfront, and **reputation** earned over time.

**Gate (supplier vetting).** Before a supplier can list, they must meet a clear bar:
- Verified business (registered legal entity, 2+ years trading, trade references)
- Certified and authentic (ISO 9001 or equivalent, only genuine OEM or authorized-distributor stock, no counterfeits)
- Lead-time reliability (95%+ on-time, documented)
- Quality and returns process (inbound inspection, clear return policy)
- Capacity and live inventory (accurate, regularly updated)
- Insurance and compliance

They upload documents; PartsPort reviews them (partly automated, partly human). Approved suppliers carry a verified status and can be suspended if they slip.

**OEM brand protection.** Only verified, **authorized** distributors of a brand can list that brand. A buyer seeing a Siemens product knows it's genuine and from an authorized seller. This is one of the OEMs' main reasons to participate, and the platform actually *reduces* counterfeit/gray-market exposure for them.

**Reputation (reviews).** After delivery, the buyer rates the supplier and the product. Real reviews accumulate; rating, on-time rate, review count shown on listings. Only buyers with a verified **delivered** order can review. Ongoing earned trust on top of the upfront vetting.

**What it solves.** Today, a buyer sourcing from an unfamiliar distributor has no way to know if the supplier is legitimate, the part is genuine, or delivery will happen. So buyers stay inside the few suppliers they already know, keeping the market closed. PartsPort's trust layer lets the buyer confidently buy from a supplier they've never met. **Trust is the core product and what justifies the fee.**

**Caveats.** Vetting is a human process: real ops cost and judgment responsibility. Approve a bad supplier and trust breaks. Real liability exposure (PartsPort vouched). Reviews need volume to mean anything; early seed ratings are placeholders. Review fraud is real; the control is verified-delivered-order required. Counterfeit detection is genuinely hard; the authorized-distributor gate is the main defense.

---

### Category 9: The Business Layer

**Not software.** Legal entity + EIN, business bank, insurance (general liability, product liability, cargo/transit), sales-tax registration, payment processor account, carrier/freight-broker accounts, lawyer-drafted documents (supplier agreement, buyer ToS, returns/claims/warranty policy, privacy policy), domain + hosting, working capital for the float.

**Pattern: for every external service the software connects to, the entity opens the account, the software integrates.** The founder opens the door; the engineering wires it in.

**Why it matters.** Without it, the other 8 categories can't legally function. You can't hold money without entity, bank, and processor. Can't collect tax without registration. Can't ship freight without carrier accounts. When you vouch for a supplier (category 8) or handle a damaged shipment (category 5), **the entity and insurance absorb that liability instead of you personally.** Lawyer-drafted contracts make terms enforceable.

**How it shows up to users.** Invisible, but its absence is instantly visible. A platform that can't invoice properly, mishandles tax, or has no terms looks "vibe-coded" and untrustworthy. The business layer earns the trust that categories 1 through 8 promise.

**Caveats.** Only the founder can do this. Sales tax across states is genuinely complex (nexus rules, marketplace-facilitator laws); get a tax professional. Don't over-build early; register sales tax in states as you gain nexus, not all 50 on day one. Spend real money on legal contracts given liability exposure. Working capital is a real funding need at scale.

**Status (per owner):** entity, EIN, bank, insurance done; domain and remaining setup in progress.

---

## 4. Lean business plan

### The problem
Sourcing industrial parts and equipment is slow, opaque, and relationship-bound. Buyers at utilities, co-ops, municipals, and contractors call several distributors, wait on quotes, and have no clean way to compare price, lead time, or legitimacy. Distributors live with feast-or-famine demand, chase leads, and chase receivables. Manufacturers sell through distribution and are largely blind to real end-demand, while counterfeit and gray-market listings put their brand at risk.

### The solution
PartsPort is a transactional online marketplace. Buyers search or describe what they need, compare vetted-supplier options, and order. Two purchasing lanes: instant checkout for in-stock items, and RFQ for big-ticket configured equipment. PartsPort handles discovery, vetting, payment, and delivery, and takes a transaction fee.

### The three parties
OEMs participate free (storefront and demand visibility, no channel conflict). Distributors stock and sell and pay the fee. Buyers need the equipment.

### Market
Starting vertical is energy and utilities equipment. The catalog is category-agnostic and built to expand. Industrial distribution is a large, highly fragmented market measured in hundreds of billions of dollars; fragmentation is exactly the condition an aggregator exploits.

### Model
Buyer pays subtotal + freight + fee + tax. Supplier receives the full part price. PartsPort keeps the fee (5 to 6 percent). Manufacturers participate free; later monetized through demand intelligence and advertising, never a transaction fee. Future revenue layers: net terms, payment margin, gated wholesale tier.

### Go-to-market
Win one narrow beachhead first. The wedge is the underserved long tail (small co-ops, municipals, contractors that nationals and enterprise procurement ignore). Hand-assemble both sides in one narrow market, run the first orders concierge-style, prove repeat liquidity, then expand. The founder's network and operating experience in energy and utilities is the primary asset for solving the marketplace cold-start.

### Competition
Real competitors: large distributors with their own e-commerce (WESCO, Border States, Graybar, Grainger) and Amazon Business at the commodity end. ThomasNet is a directory. SAP Ariba and SAP are enterprise software in a different lane. PartsPort wins by being neutral and multi-brand, vertical and serious, and faster and simpler than the status quo. Supply base: regional and mid-size distributors that cannot build their own demand engine.

### Moat
Liquidity and operations, earned over time. PartsPort deepens it by becoming the system of record: invoicing, RFQs, payments, payouts, messaging, and order history all on the platform. Guaranteed fast payment, managed fulfillment, and steady demand raise the cost of leaving. Trust through vetting and reviews is the core product.

### Operating model
AI handles volume and repetitive work (search, document parsing, catalog cleanup, RFQ triage, demand intelligence). Humans handle judgment, relationships, and physical-world exceptions (vetting, business development, logistics coordination, support, dispute resolution). The combination makes the unit economics work and the trust real.

### Traction plan
Build to full functionality. Run first orders with two known companies, concierge-style. Validate on repeat intent: do both sides say they would do the next one on PartsPort. Then scale to 10, then 50, hand-recruiting through the founder's network.

### Risks
Primary: cold-start. Secondary: disintermediation (mitigated by being more valuable than bypassing), thin margins (mitigated by ACH and wire), heavy-equipment logistics (built up over time), funding climate. Defense: reach real revenue early, keep burn low, take the irreducible bet, eliminate everything reducible.

### Status and next steps
Application code being built to full functionality. Business entity, EIN, banking, insurance in place. Next: domain and live site, first concierge test orders, then a funding round once the loop is proven.

---

## 5. Model one-pager

### How money flows
Buyer pays: part price (subtotal) + freight + platform fee + sales tax. Total goes to PartsPort, which holds it. PartsPort pays the supplier the full subtotal on cleared funds, pays the carrier the freight, remits sales tax to the state. PartsPort keeps the platform fee.

### Take rate
Recommended fee: 5 to 6 percent, added on top of the part price. 4 percent is too thin once payment processing is subtracted. The biggest margin lever is the payment rail: ACH bank transfer is roughly 0.5 to 0.8 percent and a wire is a small flat cost, versus roughly 2.9 percent for cards. B2B orders are large, so ACH and wire are the default rails. Protects margin far more than the choice of processor.

### Gross vs net
Sales tax is pass-through and is never revenue. Gross revenue = GMV times take rate. Net revenue = gross minus payment processing minus operating costs (logistics desk, support, vetting, software).

### Revenue by scale (at 5 percent take, blended across industries)

| Monthly orders | AOV $800 | AOV $2,000 | AOV $4,000 |
|---|---|---|---|
| 500/mo | $20k/mo, $240k/yr | $50k/mo, $600k/yr | $100k/mo, $1.2M/yr |
| 5,000/mo | $200k/mo, $2.4M/yr | $500k/mo, $6M/yr | $1M/mo, $12M/yr |
| 30,000/mo (about 1,000/day) | $1.2M/mo, $14M/yr | $3M/mo, $36M/yr | $6M/mo, $72M/yr |

### At roughly 1,000+ orders per day, all industries, 5 percent take
- GMV through the platform: roughly $300M to $1.4B per year.
- Gross platform revenue: roughly $1M to $6M per month, or $15M to $70M per year.
- Net after payment processing: roughly 60 to 75 percent of gross.

### Future revenue layers (beyond the transaction fee)
- OEM demand-intelligence subscriptions and advertising.
- Net terms and trade credit margin.
- Payment margin.
- Gated OEM-to-distributor wholesale tier (Phase 2).

### Cost structure
- Payment processing (minimized by ACH and wire).
- Logistics and freight coordination (asset-light, no owned warehouses).
- The ops, vetting, support, and business-development team.
- Software and hosting.
- Working capital to float supplier payouts between dispatch and settlement.

### Key metric
GMV. A marketplace is valued on GMV and on repeat liquidity. Revenue scales directly with GMV.

---

## 6. Benefits, briefable

### For buyers (utilities, co-ops, municipals, contractors, EPCs)
- Find any part fast in one place, instead of calling several distributors.
- Search by part number or describe the problem in plain language; AI surfaces every vetted option.
- Compare photo, manufacturer, price, rating, and real delivery ETA at a glance.
- Buy in-stock items instantly; request a quote for big configured equipment.
- Every supplier is vetted, so no background-checking and no counterfeits.
- One invoice, one accountable partner, delivery and tracking handled end to end.

### For suppliers (distributors)
- Qualified demand finds them the moment they list, with no lead-chasing and no marketing spend.
- Instant orders and structured RFQs all arrive in one dashboard.
- Guaranteed payment on dispatch: no credit risk, no chasing receivables. Solves their worst problem (cash flow).
- They keep the full part price; the fee is added on top of what the buyer pays.
- PartsPort handles delivery and buyer support, so they focus on supplying.
- A verified status and real reviews let a regional supplier compete with the national names.

### For manufacturers (OEMs)
- Free branded storefront with specs, datasheets, photos, and price ranges.
- Demand intelligence they have never had: what buyers search for, by region, including backorder demand.
- Brand protection: only verified, authorized distributors can list their brand. Counterfeits stay out.
- Zero channel conflict: every sale routes to their own authorized distributors.
- Reach the long tail of small buyers a field-sales team cannot justify visiting.
- Qualified leads flow straight to their distributors instead of a cold inbox.

### Why they won't leave (the value that makes leaving irrational)

Principle: you don't trap people, you make the platform more useful to use than to bypass. The platform becomes their operating system, so walking away means losing real things.

**Buyers stay because:**
- Everything in one place (search, history, invoices, one-click reorder).
- Trust layer (vetting and reviews) disappears if they go direct.
- Consolidated invoicing instead of many invoices.
- Payment terms and protection only exist on the platform.

**Suppliers stay because:**
- The demand pipe: PartsPort keeps sending new qualified buyers. Leave and that stops. The fee is cheap customer acquisition.
- Guaranteed fast payment and no credit risk gone the moment they leave.
- PartsPort handles freight, tracking, and buyer support; leaving means taking that back.
- Reputation, rating, invoices, RFQs, and records live on the platform.

**Manufacturers stay because:**
- Free, so no cost reason to go.
- Demand intelligence they cannot get elsewhere.
- Brand protection.
- Sends demand to their distributors with zero channel conflict. Nothing else does that.

**One-line value statement:** PartsPort turns a slow, opaque, relationship-bound process into a fast, transparent, trusted one. Discovery, vetting, payment, and delivery on a single platform that becomes the system of record for everyone.

---

## 7. Competition map and how we win

### Tier 1: Big distributors with their own e-commerce (most direct)
- WESCO / Anixter (~$20B+): largest utility and electrical distributor, strong utility segment.
- Border States: major utility/construction electrical distributor, employee-owned.
- Graybar: large electrical/utility distributor.
- Grainger (~$17B) and its digital-native brand Zoro: MRO long-tail giant.
- Rexel, Sonepar: global electrical distribution.

These have demand, supply, and a digital channel. **They will not join PartsPort** because they already have their own demand engine. PartsPort's supply base is the **regional and mid-size distributors** that cannot build e-commerce and demand-gen themselves.

### Tier 2: Digital marketplaces
- **Amazon Business** (~$35B+ GMV): real threat for the commodity, long-tail end; weak on configured/heavy utility-grade equipment.
- **Xometry** (public; owns ThomasNet): closest pure marketplace model, but skewed to custom manufacturing rather than off-the-shelf equipment.

### Tier 3: The status quo (the competitor that actually beats most B2B marketplaces)
The known distributor rep, the phone call, the emailed PO. Most utility and co-op buying still runs on a relationship and a fax. **"The buyer changes nothing" is the hardest competitor any new marketplace faces.**

### Not competitors
- **OEMs** (Siemens, ABB, Eaton, S&C): partners in your model, not rivals.
- **SAP / Ariba / Coupa**: enterprise procurement software, a different lane.

### How we win
- vs. **big distributors**: neutral and multi-brand. Buyers compare every vetted option in one place instead of one distributor's catalog.
- vs. **Amazon Business**: vertical and serious. Verified utility-grade suppliers, configured-equipment RFQs, real lead times, not random third-party sellers.
- vs. **the status quo**: speed and simplicity. Search, compare, order, tracked delivery, one invoice, instead of five phone calls and a week of waiting.

**Bottom line:** the real competitors are the regional distributor's status quo and Amazon Business at the low end. Not SAP, and not the national distributors who'd never join anyway.

---

## 8. Disintermediation: the strategy in detail

Disintermediation (buyer and supplier connecting once, then transacting off-platform to dodge the fee) is the existential risk for every marketplace. For a $40,000 transformer, a 5 percent fee is $2,000, which is worth a phone call to bypass. **This is real and not "don't worry about it." But it is solvable.**

**The principle:** you don't *trap* people, you make the platform genuinely **more valuable to use than to bypass**. Marketplaces that try to trap users (hide contact info, threaten penalties) mostly fail or breed resentment. Marketplaces that win make leaving irrational.

**The full set of moats:**

1. **Payment and risk absorption.** PartsPort collects from the buyer, guarantees the supplier gets paid, and protects the buyer. Off-platform, the supplier carries credit risk and chases receivables, and the buyer has no protection. That safety is worth more than the fee.

2. **The system of record.** When invoices, RFQs, order history, documents, messaging, and accounting exports all live on PartsPort, leaving means rebuilding the entire workflow from scratch.

3. **Steady demand.** The buyer found this supplier *once* on PartsPort, but the supplier stays because PartsPort keeps sending them *new* buyers. Leave and you lose the lead pipe. The 4 to 6 percent is cheap customer acquisition. No rational distributor abandons a channel delivering steady qualified demand to save a fee on one deal.

4. **Net terms / trade credit** (Phase 2). If PartsPort lets the buyer pay in 30 to 60 days, financed by the platform, that's a massive reason to stay. A single supplier cannot easily offer that. Go off-platform and the buyer loses their credit line.

5. **Consolidated invoicing.** A buyer ordering from five suppliers gets one invoice from PartsPort. Off-platform, that's five invoices, five payments, five headaches.

6. **Reputation.** A supplier's rating and review history lives on PartsPort. Off-platform they're a stranger again.

7. **Managed fulfillment.** Every operation you take off the supplier's plate (freight, tracking, claims, support) is one more thing they'd have to take *back* if they left. The more operational load PartsPort carries, the higher the switching cost. This is exactly the Amazon FBA insight.

**A fair contract clause as backup:** supplier agreements can state that orders from a PartsPort-introduced buyer route through the platform for a defined period. Not trapping; fair, because PartsPort made the introduction. **Value is the real defense; contracts are backup.**

**Some leakage is inevitable and that's fine.** The goal is not 100 percent capture; it's keeping the *majority* of volume because the platform genuinely earns its fee. Literally every category we build is the anti-disintermediation strategy.

---

## 9. The AI + humans operating model

The business scales and stays defensible because AI and humans each do what they're best at. This is also the answer to the "AI bubble" critique (section 11).

**AI does the volume and the repetitive thinking:**
- Natural-language search
- Parsing buyer POs and BOMs into structured orders
- Triaging and routing RFQs
- Cleaning a supplier's messy spreadsheet into consistent listings
- Extracting specs from datasheets
- Surfacing demand patterns
- First-line support answers

All the work that doesn't need judgment but would otherwise need an army of clerks. That's what lets PartsPort scale without headcount exploding.

**Humans do the judgment, relationships, and physical-world exceptions:**
- Vetting suppliers
- Recruiting both sides (relationship industry)
- Coordinating freight and handling damaged-shipment claims
- Account management for big buyers
- The hard support escalations
- Dispute resolution

These are not leftover tasks. They're the core of why the platform is trusted and defensible. AI alone would be a slicker directory. Humans doing the vetting, logistics, and relationships are what make it "more than a platform."

---

## 10. Asset-light logistics: why no warehouses

Owning physical warehouses is *not* needed and is *not* the right move for years. The full experience of "we handle shipping and delivery" can be delivered through **asset-light orchestration**:

- The supplier already has the part in their warehouse and already ships parts every day. Their existing warehouse *is* the warehouse.
- PartsPort owns **orchestration and accountability**: books and pays freight, generates the label, owns tracking, single point of contact, handles the problem if it goes wrong.
- The supplier becomes the pick-and-pack. PartsPort is the logistics layer on top.

Growth path: 3PL integration when scale justifies (a 3PL is just a rented warehouse). Eventually owned fulfillment if (and only if) the freight economics ever justify it. That's a capital decision, not a software requirement, and it's years out.

**The hard part is the carrier/3PL contracts and operational glue**, not the warehouse. For utility equipment you need LTL freight (heavy gear ships on pallets), a regional LTL carrier or freight broker, parcel carriers for small items.

---

## 11. Why this isn't an AI bubble play

The Bezos warning about an "AI bubble" describes "companies with no real product and a small team raising billions." That's the speculative pure-AI play. A thin wrapper, a demo, a narrative, no revenue.

**PartsPort is the structural opposite.** It is not an AI company. It is a marketplace (an old-economy, unglamorous, industrial-distribution business) that uses AI as one feature (natural-language search, document parsing). The thesis is not "AI." The thesis is "aggregate a fragmented market and take a fee on real transactions."

That distinction matters in a correction. A marketplace has concrete, measurable fundamentals: GMV, order count, repeat rate, take rate, gross margin. When fundamentals disconnect from prices, the businesses that survive are the ones that *have* fundamentals.

**The real risk in a correction is funding, not the business model.** A marketplace needs capital to solve cold-start and float payments. If venture money tightens, raising gets harder. Defense: get to real revenue early, keep burn low, don't depend on raising billions.

**Positioning rule:** do **not** brand PartsPort as an "AI company" to ride the hype. Pitch as a real marketplace with real revenue mechanics that uses AI as a tool. That story survives the correction. The "AI play" framing does not.

---

## 12. Risk shaping

Not all risk is equal. There's **irreducible** risk (will the market adopt; you only learn by trying) and **reducible** risk (overspending before validation, overbuilding, skipping the pilot).

The goal is not to be brave about all risk. It is to take the one irreducible bet and **ruthlessly eliminate everything reducible around it**. The best founders are risk-*shapers*, not risk-lovers.

PartsPort's biggest risk is concentrated in one knowable place: the cold-start (getting real supply and demand on at the same time). The single best asset for beating that risk is a founder's network in the industry. The owner has it. **The biggest risk is the one the owner is best positioned to beat.**

**Money is an accelerant, not a substitute.** Money unblocks specific things (carrier contracts, float, hiring, insurance). Money does NOT buy liquidity, trust, or relationships. Money spent before the loop is proven burns faster. Raise *after* a pilot proves the loop works.

**You cannot pre-solve every problem before launch.** Trying to is a failure mode (paralysis). Pre-solve the knowable; the pilot discovers the unknowable. Don't let "solve everything first" become the reason you never go live.

---

## 13. FAQ (anticipated hard questions, study material)

**Is this just another directory like ThomasNet?**
No. ThomasNet is a directory: you find a supplier and then transact off-platform. PartsPort is transactional. It handles discovery, payment, and delivery, and earns a fee on the transaction. It closes the loop ThomasNet leaves open.

**How is this different from Amazon Business?**
Amazon Business is strong for commodity, long-tail supplies but weak for serious industrial and configured equipment. PartsPort is vertical and serious: vetted utility-grade suppliers, a request-a-quote lane for configured equipment, real lead times, brand-authorized listings. It competes with Amazon Business only at the low end.

**Won't the big distributors like WESCO and Grainger just crush you?**
They are competitors, but they will never join the platform because they already have their own demand engine. PartsPort's supply base is the regional and mid-size distributors that cannot build their own e-commerce and demand generation. PartsPort aggregates the fragmented middle that the nationals are squeezing.

**What stops a buyer and supplier from connecting once, then going off-platform to dodge the fee?**
Disintermediation is the real risk for every marketplace. The defense is to make the platform more valuable to use than to bypass: guaranteed fast payment, managed fulfillment, consolidated invoicing, the system of record, steady new demand, and net terms the buyer loses if they leave. Some leakage is inevitable; the goal is keeping the majority of volume because the platform genuinely earns its fee.

**Do you own warehouses and trucks?**
No. The model is asset-light. The supplier ships from their existing warehouse; PartsPort books and pays the freight, generates the label and bill of lading, owns the tracking, and is accountable. PartsPort runs the logistics layer on top of rented capacity (carriers and 3PLs), not its own.

**How do you make money if the fee is 5 to 6 percent and card processing is 2.9 percent?**
By pushing ACH and wire, which cost a fraction of card. B2B orders are large, so bank rails are natural. The processor choice matters less than the payment-method mix. Future layers (OEM data and ads, net terms, payment margin) add revenue beyond the transaction fee.

**Why would manufacturers participate if they make no money from it?**
OEMs participate free and get a branded storefront, protection from counterfeit and gray-market listings, and demand intelligence they have never had. Every sale routes to their authorized distributors, so there is no channel conflict. It is a free demand channel that protects the channel they already built.

**What about counterfeits and bad suppliers?**
Every supplier is vetted before listing: registered business, certifications, authorized-distributor status, insurance. Only authorized distributors can list a given brand. Reviews add ongoing earned trust. Trust is the core product and is what justifies the fee.

**What is the biggest risk?**
The cold-start: getting real supply and real demand onto the platform at the same time. It is the thing that kills most marketplaces. The mitigation is a narrow beachhead and a founder with a real network and operating experience in energy and utilities.

**How do you handle freight cost on heavy equipment?**
Freight is a separate, explicit line in checkout and on the invoice. Parcel-shippable parts can be quoted instantly; heavy equipment is quoted within the request-a-quote lane. Heavy equipment ships LTL freight, not parcel.

**How do suppliers get paid, and who carries the risk?**
PartsPort collects the buyer's money upfront, then pays the supplier their full part price on dispatch, on cleared funds. The supplier carries no credit risk and chases no receivables. This solves the number-one pain in distribution: cash flow.

**Is this an AI company?**
No. It is a marketplace that uses AI as a tool: search, document parsing, catalog cleanup, demand intelligence. The thesis is aggregating a fragmented market and earning a fee on real transactions. AI makes the unit economics work. The business is a fundamentals business, not a speculative AI play.

**How big can this get?**
At roughly 1,000 orders per day across industries, GMV is several hundred million to over a billion dollars per year, and platform revenue is in the tens of millions per year. The market is large enough to support that and well beyond.

**Why now?**
Industrial buyers increasingly expect a consumer-grade buying experience. AI now makes natural-language search and document handling cheap and reliable. The regional distributor middle is being squeezed by the nationals and needs a demand channel. The tools to run an asset-light logistics layer (carrier and 3PL APIs) are mature.

**What does the platform do that the phone and email do not?**
It collapses days of calling and waiting into one search, gives transparent comparison, structures RFQs, guarantees payment, manages delivery with tracking, produces one consolidated invoice, and gives every party a single system of record. The status quo is the real competitor, and the platform beats it on speed, transparency, and accountability.

**Don't fraud, chargebacks, and damage claims kill this?**
These happen to every marketplace, including Amazon. The goal is not to prevent them; it is to *contain* them to a small, predictable, budgeted percentage. PartsPort actually has a structural advantage over Amazon: a vetted B2B marketplace with registered-business buyers and suppliers has far less fraud surface than an open consumer marketplace. The layers (KYC, payment-state-gated lifecycle, evidence-chain for damage, time-limited claim windows, re-verification on bank-detail change) keep losses low.

---

## 14. Strategic notes for future expansion

- **OEM monetization layers:** demand-intelligence subscriptions, advertising and promoted placement. Never a transaction fee on OEMs. These can become a larger revenue line than supplier fees (Amazon's ads dwarf its take rate).
- **Gated wholesale tier** (OEM to vetted distributor): Phase 2. The permissions model is designed to support per-OEM authorization later, but the tier itself is not built now (no pain to solve yet, would risk the OEM no-channel-conflict promise).
- **Net terms / trade credit** for buyers: Phase 2. Powerful anti-disintermediation moat. Needs working capital.
- **Demand-driven replenishment intelligence** for OEMs: PartsPort sees real end-demand; it can tell a distributor "you're about to run low, here's backorder demand building" and help time a restock with the OEM. Deepens the OEM-distributor relationship without disintermediating it.
- **Geographic and vertical expansion:** once the energy and utilities beachhead is liquid, expand to adjacent verticals.
- **International expansion:** much later.

---

## Read this whenever the launch plan does not answer the question.
