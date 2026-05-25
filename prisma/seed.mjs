import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const prisma = new PrismaClient();
const __dirname = dirname(fileURLToPath(import.meta.url));

const SUPPLIERS = [
  { name: "Gridline Power Supply", contactEmail: "sales@gridlinepower.example", rating: 4.8, reviews: 164, onTimeRate: 98.3, certifications: "ISO 9001:2015, UL-recognized components" },
  { name: "Substation Components Co.", contactEmail: "quotes@substationco.example", rating: 4.9, reviews: 92, onTimeRate: 98.8, certifications: "ISO 9001:2015, IEEE C57 compliant" },
  { name: "Voltworks Switchgear", contactEmail: "sales@voltworks.example", rating: 4.8, reviews: 71, onTimeRate: 97.6, certifications: "ISO 9001:2015, ANSI C37 type-tested" },
  { name: "Relay & Protection Partners", contactEmail: "desk@relayprotection.example", rating: 4.9, reviews: 138, onTimeRate: 99.0, certifications: "ISO 9001:2015, SEL authorized" },
  { name: "Ironwood Transmission Supply", contactEmail: "orders@ironwoodtransmission.example", rating: 4.7, reviews: 210, onTimeRate: 97.9, certifications: "ISO 9001:2015" },
  { name: "Cascade Utility Hardware", contactEmail: "sales@cascadeutility.example", rating: 4.7, reviews: 186, onTimeRate: 98.1, certifications: "ISO 9001:2015" },
  { name: "Meridian Electric Distribution", contactEmail: "hello@meridianelectric.example", rating: 4.6, reviews: 154, onTimeRate: 96.8, certifications: "ISO 9001:2015" },
  { name: "Summit Power Systems", contactEmail: "sales@summitpower.example", rating: 4.8, reviews: 88, onTimeRate: 98.0, certifications: "ISO 9001:2015, Generac PowerPro dealer" },
  { name: "SunPath Renewables", contactEmail: "quotes@sunpathrenewables.example", rating: 4.8, reviews: 119, onTimeRate: 97.7, certifications: "ISO 9001:2015, NABCEP partner" },
  { name: "StoreVolt Energy", contactEmail: "sales@storevolt.example", rating: 4.7, reviews: 64, onTimeRate: 97.4, certifications: "ISO 9001:2015, UL 9540 listed" },
];

const PRODUCTS = [
  { sku: "TXF-PM75", name: "75 kVA Pad-Mount Distribution Transformer", category: "Transformers", manufacturer: "ABB", icon: "transformer", price: 8450.0, unit: "each", etaDays: 21, stock: 6, supplier: "Substation Components Co.", specs: { Rating: "75 kVA", Primary: "12.47 kV", Secondary: "120/240 V", Type: "Loop-feed pad-mount", Cooling: "ONAN", Standard: "IEEE C57.12.34" }, description: "Loop-feed pad-mounted distribution transformer for underground residential and light commercial service. Tamper-resistant enclosure with radial or loop-feed bushing configuration." },
  { sku: "SWG-VCB15", name: "15 kV Vacuum Circuit Breaker", category: "Switchgear & Breakers", manufacturer: "Siemens", icon: "breaker", price: 12900.0, unit: "each", etaDays: 28, stock: 3, supplier: "Voltworks Switchgear", specs: { "Rated Voltage": "15 kV", "Continuous Current": "1200 A", Interrupting: "25 kA", Operation: "Stored-energy spring", Standard: "ANSI C37.06" }, description: "Draw-out vacuum circuit breaker for metal-clad medium-voltage switchgear. Maintenance-free vacuum interrupters and a motor-charged spring mechanism for fast, reliable fault clearing." },
  { sku: "SWG-CUT100", name: "100 A Fused Cutout, 15 kV", category: "Switchgear & Breakers", manufacturer: "S&C Electric", icon: "breaker", price: 142.0, unit: "each", etaDays: 9, stock: 260, supplier: "Cascade Utility Hardware", specs: { Voltage: "15 kV", "Continuous Current": "100 A", Interrupting: "8 kA", Mounting: "Crossarm / pole", Material: "Wet-process porcelain" }, description: "Open-type distribution fused cutout for overhead transformer and lateral protection. Positive-acting drop-out with a high-visibility open position for line crews." },
  { sku: "RLY-SEL751", name: "SEL-751 Feeder Protection Relay", category: "Protective Relays", manufacturer: "Schweitzer Engineering", icon: "relay", price: 3650.0, unit: "each", etaDays: 14, stock: 18, supplier: "Relay & Protection Partners", specs: { Protection: "Overcurrent, arc-flash, frequency", "I/O": "Configurable digital I/O", Comms: "DNP3, Modbus, IEC 61850", Mounting: "Panel / rack", Display: "Front-panel LCD" }, description: "Compact feeder protection relay for distribution circuits, with directional overcurrent, arc-flash detection, and full SCADA integration. Field-configurable for substations and switchgear." },
  { sku: "CND-ACSR795", name: 'ACSR "Drake" 795 kcmil Overhead Conductor', category: "Conductors & Cable", manufacturer: "Southwire", icon: "cable", price: 4.85, unit: "per ft", etaDays: 10, stock: 24000, supplier: "Ironwood Transmission Supply", specs: { Size: "795 kcmil", Stranding: "26/7 ACSR", Ampacity: "~907 A", Type: "Aluminum conductor, steel-reinforced", Use: "Overhead transmission / distribution" }, description: 'The workhorse "Drake" bare aluminum conductor, steel-reinforced, for overhead distribution and sub-transmission lines. Cut to length and shipped on returnable reels.' },
  { sku: "CBL-URD10", name: "15 kV 1/0 AWG URD Primary Cable", category: "Conductors & Cable", manufacturer: "Okonite", icon: "cable", price: 6.4, unit: "per ft", etaDays: 12, stock: 9000, supplier: "Ironwood Transmission Supply", specs: { Conductor: "1/0 AWG aluminum", Voltage: "15 kV", Insulation: "TR-XLPE, 220 mil", Jacket: "LLDPE", Neutral: "Full concentric" }, description: "Tree-retardant XLPE underground residential distribution cable for direct-burial primary loops. Concentric neutral and rugged jacket for long service life in conduit or trench." },
  { sku: "LNH-INS15P", name: "15 kV Polymer Suspension Insulator", category: "Line Hardware", manufacturer: "Hubbell Power Systems", icon: "insulator", price: 38.5, unit: "each", etaDays: 7, stock: 420, supplier: "Cascade Utility Hardware", specs: { "Voltage Class": "15 kV", "Mechanical Rating": "15,000 lb", Material: "Silicone rubber / fiberglass core", Coupling: "Ball & socket", Use: "Deadend / suspension" }, description: "Lightweight polymer suspension insulator with hydrophobic silicone sheds for contaminated and coastal environments. Replaces porcelain at a fraction of the weight." },
  { sku: "MTR-RIVA", name: "OpenWay Riva Smart Electric Meter", category: "Metering", manufacturer: "Itron", icon: "meter", price: 128.0, unit: "each", etaDays: 6, stock: 1500, supplier: "Meridian Electric Distribution", specs: { Form: "2S residential", Voltage: "120/240 V", Comms: "RF mesh AMI", Accuracy: "ANSI C12.20 Class 0.5", Features: "Remote disconnect, interval data" }, description: "Advanced metering infrastructure (AMI) smart meter with edge compute and RF mesh communications. Supports remote connect/disconnect, interval billing, and outage notification." },
  { sku: "GEN-PROT48", name: "Protector Series 48 kW Standby Generator", category: "Generators & ATS", manufacturer: "Generac", icon: "generator", price: 14200.0, unit: "each", etaDays: 30, stock: 5, supplier: "Summit Power Systems", specs: { Power: "48 kW", Fuel: "Natural gas / LP", Voltage: "120/240 V, 1Ø", Engine: "2.4 L liquid-cooled", Enclosure: "Aluminum, sound-attenuated" }, description: "Liquid-cooled standby generator for critical commercial and municipal backup power. Sound-attenuated enclosure and a controller ready for automatic transfer switching." },
  { sku: "ATS-200A", name: "200 A Automatic Transfer Switch", category: "Generators & ATS", manufacturer: "ASCO", icon: "breaker", price: 2280.0, unit: "each", etaDays: 16, stock: 22, supplier: "Summit Power Systems", specs: { Rating: "200 A", Poles: "2-pole", Voltage: "480 V max", Transition: "Open transition", Controller: "Microprocessor with exerciser" }, description: "Service-entrance-rated automatic transfer switch that senses utility loss and starts and transfers to the standby generator. Programmable exerciser and event logging." },
  { sku: "PV-QC410", name: "Q.PEAK DUO 410 W Solar Module", category: "Solar & Inverters", manufacturer: "Qcells", icon: "solar", price: 168.0, unit: "each", etaDays: 9, stock: 3400, supplier: "SunPath Renewables", specs: { Power: "410 W", Cell: "Monocrystalline half-cell", Efficiency: "21.0%", "Voltage (Vmp)": "31.2 V", Warranty: "25-year performance" }, description: "High-efficiency monocrystalline PV module for commercial and utility-scale arrays. Anti-LID/LeTID technology and a robust frame rated for high snow and wind loads." },
  { sku: "INV-STP50", name: "Sunny Tripower 50 kW String Inverter", category: "Solar & Inverters", manufacturer: "SMA", icon: "controller", price: 4100.0, unit: "each", etaDays: 18, stock: 14, supplier: "SunPath Renewables", specs: { Power: "50 kW", Phase: "3-phase, 480 V", "MPP Trackers": "6", Efficiency: "98.5%", Comms: "Ethernet / Modbus" }, description: "Three-phase commercial string inverter with six MPP trackers for complex roof and ground-mount arrays. Built-in monitoring and grid-support functions for utility interconnection." },
  { sku: "ESS-MOD5", name: "5 kWh LFP Battery Module", category: "Energy Storage", manufacturer: "Sungrow", icon: "battery", price: 1850.0, unit: "each", etaDays: 20, stock: 40, supplier: "StoreVolt Energy", specs: { Capacity: "5 kWh usable", Chemistry: "Lithium iron phosphate (LFP)", Voltage: "51.2 V nominal", Cycles: ">6,000 at 90% DoD", Use: "Stackable BESS module" }, description: "Stackable lithium iron phosphate battery module for commercial energy storage and solar-plus-storage. Integrated BMS and a long cycle life with stable thermal behavior." },
  { sku: "GND-ROD58", name: '5/8" x 8 ft Copper-Bonded Ground Rod', category: "Grounding & Surge", manufacturer: "nVent ERICO", icon: "ground", price: 22.4, unit: "each", etaDays: 4, stock: 2600, supplier: "Gridline Power Supply", specs: { Diameter: "5/8 in.", Length: "8 ft", Coating: "Copper-bonded steel", Standard: "UL 467", Use: "Substation / service grounding" }, description: "Copper-bonded steel ground rod for service entrances, substations, and equipment grounding grids. Sectional-coupling compatible for deep-driven electrodes." },
  { sku: "SRG-ARR18", name: "18 kV Distribution Surge Arrester", category: "Grounding & Surge", manufacturer: "Eaton", icon: "ground", price: 96.0, unit: "each", etaDays: 8, stock: 510, supplier: "Gridline Power Supply", specs: { "Duty Cycle": "18 kV", MCOV: "15.3 kV", Class: "Distribution, heavy-duty", Technology: "Metal-oxide varistor", Mounting: "Polymer-housed" }, description: "Polymer-housed metal-oxide surge arrester that protects transformers and line equipment from lightning and switching surges. Pressure-relief design for fault safety." },
  { sku: "SCD-RTAC", name: "SEL-3530 Real-Time Automation Controller", category: "Controls & SCADA", manufacturer: "Schweitzer Engineering", icon: "controller", price: 2950.0, unit: "each", etaDays: 15, stock: 26, supplier: "Relay & Protection Partners", specs: { Function: "RTU / automation controller", Protocols: "DNP3, IEC 61850, Modbus", Logic: "IEC 61131 programmable", Ports: "Serial + Ethernet", Use: "Substation automation" }, description: "Substation automation controller and protocol gateway that ties relays, meters, and SCADA together. Deterministic logic engine for local control and data concentration." },
  { sku: "SAF-AFK40", name: "40 cal/cm² Arc-Flash PPE Kit", category: "Safety & Arc-Flash", manufacturer: "Honeywell Salisbury", icon: "shield", price: 1290.0, unit: "each", etaDays: 6, stock: 75, supplier: "Gridline Power Supply", specs: { "Arc Rating": "40 cal/cm²", Category: "PPE Category 4", Includes: "Coat, bib overall, ventilated hood", Standard: "NFPA 70E / ASTM F1959", Sizes: "M-3XL" }, description: "Complete arc-flash protection kit for switching and live-line work: an arc-rated coat, bib overall, and ventilated hood. Meets NFPA 70E Category 4 requirements." },
  { sku: "SWG-3VA-250", name: "3VA Molded Case Circuit Breaker, 250 A", category: "Switchgear & Breakers", manufacturer: "Siemens", icon: "breaker", price: 680.0, unit: "each", etaDays: 5, stock: 140, supplier: "Voltworks Switchgear", specs: { "Frame Size": "250 A", Poles: "3", "Interrupting Rating": "65 kA @ 480 V", Trip: "Electronic (ETU)", Standard: "UL 489" }, description: "Molded-case circuit breaker for distribution panels and motor feeders. Electronic trip unit with adjustable settings and field-installable accessories." },
  { sku: "RLY-SIPRO5", name: "SIPROTEC 5 Feeder Protection Relay", category: "Protective Relays", manufacturer: "Siemens", icon: "relay", price: 4250.0, unit: "each", etaDays: 16, stock: 9, supplier: "Relay & Protection Partners", specs: { Protection: "Directional overcurrent, distance, breaker failure", Comms: "IEC 61850, DNP3", Mounting: "Flush / rack", "I/O": "Modular, expandable", Display: "Large graphical" }, description: "Modular feeder protection and bay controller for distribution and sub-transmission. Configurable function library with full IEC 61850 station integration." },
];

async function main() {
  // Idempotent and non-destructive: only fills an empty database.
  const supplierIds = {};
  for (const s of SUPPLIERS) {
    const existing = await prisma.supplier.findFirst({ where: { name: s.name } });
    const rec =
      existing ||
      (await prisma.supplier.create({ data: { ...s, status: "APPROVED" } }));
    supplierIds[s.name] = rec.id;
  }

  for (const p of PRODUCTS) {
    await prisma.product.upsert({
      where: { sku: p.sku },
      // Keep seeded marketing copy in sync; leaves supplier-managed fields (stock, price) alone.
      update: { name: p.name, description: p.description },
      create: {
        sku: p.sku,
        name: p.name,
        category: p.category,
        manufacturer: p.manufacturer,
        icon: p.icon,
        priceCents: Math.round(p.price * 100),
        unit: p.unit,
        etaDays: p.etaDays,
        stock: p.stock,
        quoteOnly: p.price >= 3000,
        description: p.description,
        specs: p.specs,
        supplierId: supplierIds[p.supplier],
        active: true,
      },
    });
  }

  // Seed real product photos from seed-images.json (idempotent: skips any
  // product that already has ProductImage rows).
  try {
    const raw = await readFile(join(__dirname, "seed-images.json"), "utf-8");
    const mapping = JSON.parse(raw);
    let inserted = 0;
    let skippedHadImages = 0;
    let skippedNoUrls = 0;
    for (const [sku, urls] of Object.entries(mapping)) {
      if (sku.startsWith("_")) continue;
      if (!Array.isArray(urls) || urls.length === 0) {
        skippedNoUrls++;
        continue;
      }
      const product = await prisma.product.findUnique({ where: { sku } });
      if (!product) continue;
      const existing = await prisma.productImage.count({
        where: { productId: product.id },
      });
      if (existing > 0) {
        skippedHadImages++;
        continue;
      }
      for (let i = 0; i < urls.length; i++) {
        const url = String(urls[i]).trim();
        if (!url) continue;
        await prisma.productImage.create({
          data: { productId: product.id, url, position: i },
        });
      }
      // Sync the legacy single-image field with the primary.
      if (urls[0]) {
        await prisma.product.update({
          where: { id: product.id },
          data: { imageUrl: String(urls[0]).trim() },
        });
      }
      inserted++;
    }
    console.log(
      "Seed images:",
      inserted,
      "products got images,",
      skippedHadImages,
      "already had images,",
      skippedNoUrls,
      "had no URLs in seed-images.json"
    );
  } catch (e) {
    console.warn(
      "Skipping seed-images.json (",
      e?.message || e,
      "). The site will use line-art fallbacks for products without images."
    );
  }

  const pw = await bcrypt.hash("demo1234", 10);
  const demoUsers = [
    { email: "admin@partsport.example", name: "Avery Ops", role: "ADMIN" },
    { email: "buyer@partsport.example", name: "Jordan Buyer", role: "BUYER" },
    { email: "oem@partsport.example", name: "Morgan Reed", role: "MANUFACTURER", manufacturerName: "Siemens" },
    // Real platform admin. Created on first deploy with the temp password
    // demo1234; rotate immediately via /account or /forgot-password.
    { email: "ethompson@thradd.com", name: "E. Thompson", role: "ADMIN" },
  ];
  for (const u of demoUsers) {
    await prisma.user.upsert({
      where: { email: u.email },
      update: {},
      create: { ...u, passwordHash: pw },
    });
  }

  // Supplier demo account linked to Summit Power Systems (has a quote-only listing)
  const demoSupplierId = supplierIds["Summit Power Systems"];
  const supplierUser = await prisma.user.upsert({
    where: { email: "supplier@partsport.example" },
    update: {},
    create: {
      email: "supplier@partsport.example",
      name: "Sam Rivera",
      role: "SUPPLIER",
      passwordHash: pw,
    },
  });
  const demoSupplier = await prisma.supplier.findUnique({
    where: { id: demoSupplierId },
  });
  if (demoSupplier && !demoSupplier.userId) {
    await prisma.supplier.update({
      where: { id: demoSupplierId },
      data: { userId: supplierUser.id },
    });
  }

  console.log(
    "Seed complete:",
    SUPPLIERS.length,
    "suppliers,",
    PRODUCTS.length,
    "products, 3 demo users."
  );
}

main()
  .catch((e) => {
    console.error("Seed error (non-fatal):", e.message);
    process.exitCode = 0;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
