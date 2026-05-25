import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const prisma = new PrismaClient();
const __dirname = dirname(fileURLToPath(import.meta.url));

// Supplier brand marks. Sourced from ui-avatars.com which serves clean
// monogram SVGs - good enough for launch when we don't have real logos
// from each supplier yet. Replace with a Vercel Blob-hosted PNG/SVG once
// the supplier uploads their own through /supplier#profile. Background
// colors chosen to feel industrial (deep, muted tones).
const logo = (name, bg, color = "ffffff") =>
  `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&size=400&background=${bg}&color=${color}&bold=true&format=svg`;

const SUPPLIERS = [
  { name: "Gridline Power Supply", contactEmail: "sales@gridlinepower.example", rating: 4.8, reviews: 164, onTimeRate: 98.3, certifications: "ISO 9001:2015, UL-recognized components", logoUrl: logo("Gridline Power", "1a1916", "e0a32a") },
  { name: "Substation Components Co.", contactEmail: "quotes@substationco.example", rating: 4.9, reviews: 92, onTimeRate: 98.8, certifications: "ISO 9001:2015, IEEE C57 compliant", logoUrl: logo("Substation Components", "2c3e50") },
  { name: "Voltworks Switchgear", contactEmail: "sales@voltworks.example", rating: 4.8, reviews: 71, onTimeRate: 97.6, certifications: "ISO 9001:2015, ANSI C37 type-tested", logoUrl: logo("Voltworks Switchgear", "b8860b") },
  { name: "Relay & Protection Partners", contactEmail: "desk@relayprotection.example", rating: 4.9, reviews: 138, onTimeRate: 99.0, certifications: "ISO 9001:2015, SEL authorized", logoUrl: logo("Relay Protection", "8b2c2c") },
  { name: "Ironwood Transmission Supply", contactEmail: "orders@ironwoodtransmission.example", rating: 4.7, reviews: 210, onTimeRate: 97.9, certifications: "ISO 9001:2015", logoUrl: logo("Ironwood Transmission", "5c4033") },
  { name: "Cascade Utility Hardware", contactEmail: "sales@cascadeutility.example", rating: 4.7, reviews: 186, onTimeRate: 98.1, certifications: "ISO 9001:2015", logoUrl: logo("Cascade Utility", "2c5f3f") },
  { name: "Meridian Electric Distribution", contactEmail: "hello@meridianelectric.example", rating: 4.6, reviews: 154, onTimeRate: 96.8, certifications: "ISO 9001:2015", logoUrl: logo("Meridian Electric", "4a5568") },
  { name: "Summit Power Systems", contactEmail: "sales@summitpower.example", rating: 4.8, reviews: 88, onTimeRate: 98.0, certifications: "ISO 9001:2015, Generac PowerPro dealer", logoUrl: logo("Summit Power", "1e3a5f") },
  { name: "SunPath Renewables", contactEmail: "quotes@sunpathrenewables.example", rating: 4.8, reviews: 119, onTimeRate: 97.7, certifications: "ISO 9001:2015, NABCEP partner", logoUrl: logo("SunPath Renewables", "d97706") },
  { name: "StoreVolt Energy", contactEmail: "sales@storevolt.example", rating: 4.7, reviews: 64, onTimeRate: 97.4, certifications: "ISO 9001:2015, UL 9540 listed", logoUrl: logo("StoreVolt Energy", "1e5fa3") },
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

  // --- Catalog expansion: variants across every category so the catalog
  // crosses the PAGE_SIZE = 24 threshold and pagination actually renders. ---

  // Transformers
  { sku: "TXF-PM25", name: "25 kVA Pad-Mount Distribution Transformer", category: "Transformers", manufacturer: "Eaton", icon: "transformer", price: 5300.0, unit: "each", etaDays: 24, stock: 4, supplier: "Substation Components Co.", specs: { Rating: "25 kVA", Primary: "12.47 kV", Secondary: "120/240 V", Type: "Pad-mount", Cooling: "ONAN" }, description: "Single-phase pad-mounted distribution transformer for residential service. Tamper-resistant, dead-front design suited to underground laterals." },
  { sku: "TXF-PM167", name: "167 kVA Pad-Mount Distribution Transformer", category: "Transformers", manufacturer: "Howard Industries", icon: "transformer", price: 14200.0, unit: "each", etaDays: 34, stock: 2, supplier: "Substation Components Co.", specs: { Rating: "167 kVA", Primary: "12.47 kV", Secondary: "208Y/120 V", Type: "Three-phase pad-mount" }, description: "Three-phase pad-mounted transformer for light-commercial and multi-tenant service drops. Optional radial or loop-feed bushing layout." },
  { sku: "TXF-OL50", name: "50 kVA Single-Phase Pole-Top Transformer", category: "Transformers", manufacturer: "ABB", icon: "transformer", price: 6900.0, unit: "each", etaDays: 18, stock: 7, supplier: "Substation Components Co.", specs: { Rating: "50 kVA", Primary: "14.4 kV", Secondary: "120/240 V", Type: "Overhead pole-top", Cooling: "ONAN" }, description: "Conventional overhead distribution transformer for rural feeders. CSP fusing and built-in lightning arrester optional." },
  { sku: "TXF-DRY15", name: "15 kVA Dry-Type Indoor Transformer", category: "Transformers", manufacturer: "Square D", icon: "transformer", price: 1850.0, unit: "each", etaDays: 9, stock: 18, supplier: "Meridian Electric Distribution", specs: { Rating: "15 kVA", Primary: "480 V", Secondary: "208Y/120 V", Type: "Dry-type, NEMA 3R", Insulation: "Class H 180 °C" }, description: "Dry-type general-purpose transformer for commercial step-down service. Quiet, low-loss core suitable for office and retail environments." },
  { sku: "TXF-AUTO500", name: "500 kVA 480/240 V Autotransformer", category: "Transformers", manufacturer: "ACME Electric", icon: "transformer", price: 11200.0, unit: "each", etaDays: 22, stock: 3, supplier: "Substation Components Co.", specs: { Rating: "500 kVA", Voltage: "480-240 V auto", Type: "Dry, ventilated", Use: "Step-down service" }, description: "Buck-boost autotransformer for industrial 480-to-240 V step-down conversion. Optional copper or aluminum winding." },

  // Switchgear & Breakers
  { sku: "SWG-NX-630", name: "NX Air Circuit Breaker, 630 A", category: "Switchgear & Breakers", manufacturer: "ABB", icon: "breaker", price: 4280.0, unit: "each", etaDays: 12, stock: 14, supplier: "Voltworks Switchgear", specs: { "Frame Size": "630 A", Poles: "3", "Interrupting Rating": "50 kA @ 690 V", Trip: "Electronic (Ekip)", Standard: "IEC 60947-2" }, description: "Withdrawable air circuit breaker for low-voltage main distribution panels. Modular trip units with arc-flash sensing." },
  { sku: "SWG-CUT200", name: "200 A Loadbreak Cutout, 15 kV", category: "Switchgear & Breakers", manufacturer: "S&C Electric", icon: "breaker", price: 192.0, unit: "each", etaDays: 8, stock: 180, supplier: "Cascade Utility Hardware", specs: { Voltage: "15 kV", "Continuous Current": "200 A", Interrupting: "10 kA", Mounting: "Crossarm / pole" }, description: "Loadbreak distribution cutout for higher-current transformer protection. Same physical envelope as 100 A type for easy field swap." },
  { sku: "SWG-MCC1200", name: "1200 A Motor Control Center Section", category: "Switchgear & Breakers", manufacturer: "Eaton", icon: "breaker", price: 8900.0, unit: "each", etaDays: 30, stock: 2, supplier: "Voltworks Switchgear", specs: { Rating: "1200 A", Voltage: "480 V", Section: "20 in. shipping split", Buckets: "NEMA Size 2-5 starters" }, description: "NEMA-style MCC section for industrial motor control. Plug-in buckets for fast change-out and seismic-rated enclosure." },
  { sku: "SWG-PNL400", name: "400 A Panelboard, 42 Circuit", category: "Switchgear & Breakers", manufacturer: "Square D", icon: "breaker", price: 1240.0, unit: "each", etaDays: 7, stock: 60, supplier: "Meridian Electric Distribution", specs: { Rating: "400 A", Voltage: "208Y/120 V", Bus: "Copper", Circuits: "42 (main breaker)" }, description: "Three-phase panelboard for commercial subdistribution. Bolt-on breakers, copper bus, NEMA 1 enclosure." },
  { sku: "SWG-LIM100", name: "100 A Current-Limiting Fuse, 15 kV", category: "Switchgear & Breakers", manufacturer: "Mersen", icon: "breaker", price: 168.0, unit: "each", etaDays: 6, stock: 220, supplier: "Cascade Utility Hardware", specs: { Voltage: "15.5 kV", "Continuous Current": "100 A", Interrupting: "65 kA", Class: "Current-limiting (E-rated)" }, description: "Current-limiting fuse for transformer primary protection. Ferrule design fits standard fuse clips." },
  { sku: "SWG-DSCN600", name: "600 A Three-Pole Group-Operated Disconnect", category: "Switchgear & Breakers", manufacturer: "Hubbell Power Systems", icon: "breaker", price: 2480.0, unit: "each", etaDays: 14, stock: 8, supplier: "Voltworks Switchgear", specs: { Rating: "600 A", Voltage: "34.5 kV", Poles: "3-pole, gang", Operation: "Hookstick / motor-operator ready" }, description: "Pole-top air-break switch for overhead distribution sectionalizing. Field-installable motor operator for remote SCADA control." },

  // Protective Relays
  { sku: "RLY-SEL351", name: "SEL-351 Distribution Protection Relay", category: "Protective Relays", manufacturer: "Schweitzer Engineering", icon: "relay", price: 2950.0, unit: "each", etaDays: 12, stock: 22, supplier: "Relay & Protection Partners", specs: { Protection: "Phase / ground overcurrent, recloser, breaker failure", Comms: "DNP3, Modbus", Mounting: "Panel / rack", Display: "Front-panel LCD" }, description: "Workhorse distribution protection relay with recloser logic. Field-configurable for substation and overhead feeder protection." },
  { sku: "RLY-MICOM-P54", name: "MiCOM P54 Differential Relay", category: "Protective Relays", manufacturer: "Schneider Electric", icon: "relay", price: 5800.0, unit: "each", etaDays: 22, stock: 4, supplier: "Relay & Protection Partners", specs: { Protection: "Line current differential", Comms: "IEC 61850, fiber direct", Mounting: "Flush", "I/O": "Programmable" }, description: "Line-current-differential protection for sub-transmission lines and parallel feeders. Built-in fiber comms for end-to-end signaling." },
  { sku: "RLY-RET670", name: "RET670 Transformer Protection IED", category: "Protective Relays", manufacturer: "ABB", icon: "relay", price: 6420.0, unit: "each", etaDays: 24, stock: 3, supplier: "Relay & Protection Partners", specs: { Protection: "Restrained differential, REF, overflux", Comms: "IEC 61850 station bus", Display: "Color LCD" }, description: "High-end transformer protection IED with disturbance recording and integrated bay control." },
  { sku: "RLY-FA-RECL", name: "Recloser Control, 38 kV Class", category: "Protective Relays", manufacturer: "Eaton", icon: "relay", price: 4680.0, unit: "each", etaDays: 18, stock: 6, supplier: "Relay & Protection Partners", specs: { Voltage: "38 kV", Recloses: "Up to 4 shots", Comms: "DNP3, SCADA-ready", Type: "Hydraulic-controlled vacuum recloser" }, description: "Three-phase vacuum recloser with intelligent control for overhead feeder fault clearing and restoration." },

  // Conductors & Cable
  { sku: "CND-ACSR397", name: 'ACSR "Ibis" 397.5 kcmil Conductor', category: "Conductors & Cable", manufacturer: "Southwire", icon: "cable", price: 2.95, unit: "per ft", etaDays: 9, stock: 32000, supplier: "Ironwood Transmission Supply", specs: { Size: "397.5 kcmil", Stranding: "26/7 ACSR", Ampacity: "~636 A", Use: "Overhead distribution" }, description: "Bare aluminum conductor steel-reinforced for medium-feeder overhead use. Cut to length on returnable reels." },
  { sku: "CND-AAAC477", name: 'AAAC "Greeley" 477 kcmil Conductor', category: "Conductors & Cable", manufacturer: "General Cable", icon: "cable", price: 3.85, unit: "per ft", etaDays: 11, stock: 12000, supplier: "Ironwood Transmission Supply", specs: { Size: "477 kcmil", Stranding: "37 AAAC", Use: "Overhead transmission" }, description: "All-aluminum-alloy conductor offering lower weight and better corrosion resistance than ACSR. Suited to coastal lines." },
  { sku: "CBL-MV1000", name: "1000 kcmil 15 kV MV-105 Cable", category: "Conductors & Cable", manufacturer: "Prysmian", icon: "cable", price: 19.4, unit: "per ft", etaDays: 16, stock: 4500, supplier: "Ironwood Transmission Supply", specs: { Conductor: "1000 kcmil copper", Voltage: "15 kV", Insulation: "EPR, 133% level", Jacket: "PVC" }, description: "Industrial medium-voltage power cable for switchgear feeders. EPR insulation for high reliability in conduit." },
  { sku: "CBL-SVC4-4-4", name: "Triplex Service Cable 4/0-4/0-2/0 Aluminum", category: "Conductors & Cable", manufacturer: "Southwire", icon: "cable", price: 3.20, unit: "per ft", etaDays: 5, stock: 28000, supplier: "Cascade Utility Hardware", specs: { Conductor: "Aluminum, triplex", Sizes: "4/0-4/0-2/0", Use: "600 V service drop" }, description: "Aluminum triplex service drop for overhead 120/240 V residential service. UV-stable XLPE insulation." },
  { sku: "CBL-CTRL14", name: "14 AWG Type-TC Control Cable, 12-conductor", category: "Conductors & Cable", manufacturer: "Belden", icon: "cable", price: 1.95, unit: "per ft", etaDays: 6, stock: 18000, supplier: "Meridian Electric Distribution", specs: { Size: "14 AWG", Conductors: "12", Type: "TC-ER", Voltage: "600 V" }, description: "Tray-cable rated multi-conductor control cable for substation panels and industrial control wiring." },

  // Line Hardware
  { sku: "LNH-INS35P", name: "35 kV Polymer Suspension Insulator", category: "Line Hardware", manufacturer: "MacLean Power Systems", icon: "insulator", price: 64.0, unit: "each", etaDays: 8, stock: 360, supplier: "Cascade Utility Hardware", specs: { "Voltage Class": "35 kV", "Mechanical Rating": "25,000 lb", Coupling: "Y-clevis" }, description: "Polymer suspension insulator for medium-voltage deadend and tangent assemblies." },
  { sku: "LNH-PINS25P", name: "25 kV Polymer Pin Insulator", category: "Line Hardware", manufacturer: "Hubbell Power Systems", icon: "insulator", price: 46.0, unit: "each", etaDays: 6, stock: 540, supplier: "Cascade Utility Hardware", specs: { "Voltage Class": "25 kV", Mounting: "1 in. pin", Material: "Silicone rubber" }, description: "Lightweight pin-type polymer insulator for tangent crossarm structures. Replaces porcelain at lower weight." },
  { sku: "LNH-CARM8", name: '8 ft Fiberglass Crossarm', category: "Line Hardware", manufacturer: "MacLean Power Systems", icon: "insulator", price: 240.0, unit: "each", etaDays: 12, stock: 95, supplier: "Cascade Utility Hardware", specs: { Length: "8 ft", Material: "Pultruded fiberglass", Use: "Single-circuit tangent" }, description: "Fiberglass crossarm for distribution structures. Non-conductive, UV-stable, lighter than treated wood." },
  { sku: "LNH-DEADEND", name: "Deadend Suspension Clamp, 397-477 kcmil", category: "Line Hardware", manufacturer: "Preformed Line Products", icon: "insulator", price: 18.5, unit: "each", etaDays: 5, stock: 1200, supplier: "Cascade Utility Hardware", specs: { Range: "397-477 kcmil", Material: "Aluminum alloy", Use: "Deadend / strain" }, description: "Bolted-aluminum deadend clamp for ACSR conductors. Field-installable, no special tools." },

  // Metering
  { sku: "MTR-FOC", name: "Focus AX Single-Phase Meter", category: "Metering", manufacturer: "Landis+Gyr", icon: "meter", price: 142.0, unit: "each", etaDays: 7, stock: 1100, supplier: "Meridian Electric Distribution", specs: { Form: "2S residential", Voltage: "120/240 V", Comms: "RF mesh / cellular", Accuracy: "ANSI C12.20 Class 0.2" }, description: "AMI residential electric meter with cellular and RF mesh options. Time-of-use and demand recording." },
  { sku: "MTR-CT-200", name: "200 A Window CT, Revenue Class", category: "Metering", manufacturer: "Schneider Electric", icon: "meter", price: 86.0, unit: "each", etaDays: 9, stock: 320, supplier: "Meridian Electric Distribution", specs: { Ratio: "200:5", Accuracy: "0.3% (revenue)", Window: "1.5 in.", Burden: "B0.2-B1.0" }, description: "Window-style current transformer for revenue metering installations. Split-core variant also available." },
  { sku: "MTR-INDS", name: "Industrial 3-Phase Smart Meter", category: "Metering", manufacturer: "Itron", icon: "meter", price: 380.0, unit: "each", etaDays: 11, stock: 220, supplier: "Meridian Electric Distribution", specs: { Form: "9S", Voltage: "120-480 V", Comms: "Ethernet + cellular", Features: "Power-quality logging" }, description: "Three-phase industrial AMI meter with high-resolution power quality and demand profiling." },

  // Generators & ATS
  { sku: "GEN-PROT22", name: "Protector Series 22 kW Standby Generator", category: "Generators & ATS", manufacturer: "Generac", icon: "generator", price: 7950.0, unit: "each", etaDays: 22, stock: 11, supplier: "Summit Power Systems", specs: { Power: "22 kW", Fuel: "Natural gas / LP", Voltage: "120/240 V, 1Ø", Enclosure: "Aluminum, sound-attenuated" }, description: "Air-cooled residential and light-commercial standby generator. Smart controller with mobile alerts." },
  { sku: "GEN-DIESEL100", name: "100 kW Diesel Standby Generator", category: "Generators & ATS", manufacturer: "Cummins", icon: "generator", price: 32400.0, unit: "each", etaDays: 60, stock: 1, supplier: "Summit Power Systems", specs: { Power: "100 kW", Fuel: "Diesel", Voltage: "480 V, 3Ø", Tank: "Sub-base 24 hr" }, description: "Diesel standby genset for critical commercial backup. Sub-base fuel tank and weatherproof enclosure." },
  { sku: "ATS-400A", name: "400 A Service-Entrance ATS", category: "Generators & ATS", manufacturer: "ASCO", icon: "breaker", price: 4180.0, unit: "each", etaDays: 18, stock: 9, supplier: "Summit Power Systems", specs: { Rating: "400 A", Poles: "3-pole + neutral", Voltage: "480 V max", Transition: "Open or delayed" }, description: "Service-entrance-rated automatic transfer switch with programmable transition modes. UL 1008 listed." },

  // Solar & Inverters
  { sku: "PV-QC430", name: "Q.PEAK DUO 430 W Solar Module", category: "Solar & Inverters", manufacturer: "Qcells", icon: "solar", price: 184.0, unit: "each", etaDays: 8, stock: 2800, supplier: "SunPath Renewables", specs: { Power: "430 W", Cell: "Mono half-cell", Efficiency: "21.4%", Warranty: "25-year" }, description: "Higher-output Q.PEAK module for utility-scale and rooftop arrays. Optimized for warm-climate performance." },
  { sku: "INV-FRONIUS50", name: "Fronius SYMO 50 kW String Inverter", category: "Solar & Inverters", manufacturer: "Fronius", icon: "controller", price: 4280.0, unit: "each", etaDays: 16, stock: 12, supplier: "SunPath Renewables", specs: { Power: "50 kW", Phase: "3-phase, 480 V", "MPP Trackers": "3", Efficiency: "98.3%" }, description: "Three-phase commercial string inverter with integrated DC arc-fault and rapid shutdown." },
  { sku: "PV-MICRO-IQ8", name: "Enphase IQ8 Microinverter", category: "Solar & Inverters", manufacturer: "Enphase", icon: "controller", price: 158.0, unit: "each", etaDays: 6, stock: 6200, supplier: "SunPath Renewables", specs: { Power: "384 VA peak", Phase: "Single-phase, 240 V", Comms: "Powerline" }, description: "Microinverter for module-level conversion. Sunlight-backup capable when paired with Enphase battery." },
  { sku: "PV-RACK-IB", name: "IronRidge XR1000 Rail, 14 ft", category: "Solar & Inverters", manufacturer: "IronRidge", icon: "solar", price: 96.0, unit: "each", etaDays: 5, stock: 1800, supplier: "SunPath Renewables", specs: { Length: "14 ft", Material: "Aluminum", Use: "Rooftop racking", Load: "All snow / wind zones" }, description: "Heavy-rail rooftop solar racking for commercial pitched and flat-roof arrays. UL 2703 certified system." },

  // Energy Storage
  { sku: "ESS-MOD10", name: "10 kWh LFP Battery Module", category: "Energy Storage", manufacturer: "Sungrow", icon: "battery", price: 3400.0, unit: "each", etaDays: 22, stock: 28, supplier: "StoreVolt Energy", specs: { Capacity: "10 kWh usable", Chemistry: "LFP", Voltage: "102 V", Cycles: ">6,000" }, description: "Larger LFP module for utility-scale and commercial energy storage stacks." },
  { sku: "ESS-INV30", name: "30 kW Hybrid PV+Storage Inverter", category: "Energy Storage", manufacturer: "Sungrow", icon: "controller", price: 6280.0, unit: "each", etaDays: 19, stock: 5, supplier: "StoreVolt Energy", specs: { Power: "30 kW AC", DC: "PV + battery dual input", Comms: "Ethernet / RS485" }, description: "Hybrid inverter for solar-plus-storage commercial sites. Grid-tied and microgrid-capable." },
  { sku: "ESS-RACK", name: "BESS Indoor Cabinet, 20 module bays", category: "Energy Storage", manufacturer: "Eaton", icon: "battery", price: 2950.0, unit: "each", etaDays: 25, stock: 4, supplier: "StoreVolt Energy", specs: { Modules: "Up to 20", Cooling: "Forced air", Communication: "BMS daisy-chain" }, description: "Indoor-rated battery cabinet for scalable BESS deployments. UL 9540 listed system option." },

  // Grounding & Surge
  { sku: "GND-CLAMP58", name: '5/8" Bronze Ground Clamp', category: "Grounding & Surge", manufacturer: "nVent ERICO", icon: "ground", price: 6.4, unit: "each", etaDays: 4, stock: 4200, supplier: "Gridline Power Supply", specs: { Diameter: "5/8 in.", Material: "Bronze", Range: "#10-#4 AWG" }, description: "Direct-burial bronze ground rod clamp for #10 to #4 AWG copper. UL 467 listed." },
  { sku: "GND-CADWELD", name: "Cadweld Exothermic Weld Kit, 1/0 to ground rod", category: "Grounding & Surge", manufacturer: "nVent ERICO", icon: "ground", price: 38.0, unit: "kit", etaDays: 7, stock: 240, supplier: "Gridline Power Supply", specs: { Connection: "1/0 cable to 5/8 in. rod", Mold: "F33", Includes: "Powder + igniter" }, description: "Single-shot exothermic weld kit for permanent grounding connections. UL listed." },
  { sku: "SRG-ARR36", name: "36 kV Distribution Surge Arrester", category: "Grounding & Surge", manufacturer: "Hubbell Power Systems", icon: "ground", price: 158.0, unit: "each", etaDays: 9, stock: 280, supplier: "Gridline Power Supply", specs: { "Duty Cycle": "36 kV", MCOV: "29 kV", Class: "Distribution, heavy-duty" }, description: "Polymer-housed MOV surge arrester for 34.5 kV class equipment protection." },

  // Controls & SCADA
  { sku: "SCD-SEL2240", name: "SEL-2240 Axion Programmable Controller", category: "Controls & SCADA", manufacturer: "Schweitzer Engineering", icon: "controller", price: 1820.0, unit: "each", etaDays: 12, stock: 14, supplier: "Relay & Protection Partners", specs: { Function: "Programmable IED", "I/O": "Modular", Comms: "Ethernet, serial, DNP3" }, description: "Modular programmable I/O controller with substation-grade hardening. IEC 61131 logic." },
  { sku: "SCD-RTU-DL8", name: "DataLink-8 SCADA RTU", category: "Controls & SCADA", manufacturer: "Eaton", icon: "controller", price: 2240.0, unit: "each", etaDays: 14, stock: 7, supplier: "Relay & Protection Partners", specs: { Function: "Outdoor SCADA RTU", Protocols: "DNP3, Modbus", Comms: "Cellular + serial" }, description: "Pole-mount outdoor SCADA RTU for recloser, capacitor bank, and switch control." },

  // Safety & Arc-Flash
  { sku: "SAF-AFK12", name: "12 cal/cm² Arc-Flash Suit", category: "Safety & Arc-Flash", manufacturer: "Honeywell Salisbury", icon: "shield", price: 480.0, unit: "each", etaDays: 5, stock: 120, supplier: "Gridline Power Supply", specs: { "Arc Rating": "12 cal/cm²", Category: "PPE Category 2", Includes: "Coat + hood" }, description: "Mid-rating arc-flash kit for typical maintenance switching. Compliant with NFPA 70E." },
  { sku: "SAF-VOLTM", name: "Audible Voltage Detector, 240 V to 36 kV", category: "Safety & Arc-Flash", manufacturer: "HD Electric", icon: "shield", price: 320.0, unit: "each", etaDays: 4, stock: 95, supplier: "Gridline Power Supply", specs: { Range: "240 V to 36 kV", Audible: "Yes", Standard: "OSHA 1910.269 compliant" }, description: "Audible / visual voltage detector for lineworker safety checks. Battery-powered, hot-stick compatible." },
  { sku: "SAF-RUBGLV", name: 'Class 2 Rubber Insulating Gloves, 14"', category: "Safety & Arc-Flash", manufacturer: "Honeywell Salisbury", icon: "shield", price: 78.0, unit: "pair", etaDays: 4, stock: 320, supplier: "Gridline Power Supply", specs: { Class: "Class 2 (17 kV)", Length: "14 in.", Standard: "ASTM D120" }, description: "Class 2 rubber insulating gloves for switching and equipment work. Leather protectors sold separately." },
];

async function main() {
  // Idempotent and non-destructive: only fills an empty database.
  const supplierIds = {};
  for (const s of SUPPLIERS) {
    const existing = await prisma.supplier.findFirst({ where: { name: s.name } });
    let rec;
    if (existing) {
      // Top-up missing fields without overwriting any supplier-edited values.
      // Currently only logoUrl: if a supplier has uploaded their own, leave
      // it alone; otherwise fill in the seed default.
      if (!existing.logoUrl && s.logoUrl) {
        rec = await prisma.supplier.update({
          where: { id: existing.id },
          data: { logoUrl: s.logoUrl },
        });
      } else {
        rec = existing;
      }
    } else {
      // Seeded demo suppliers are pre-onboarded: publicVisible so their
      // products show on the catalog and bank info marked on file. Real
      // suppliers (added via /admin AddSupplierForm or the application
      // flow) start hidden and have to complete the onboarding checklist.
      rec = await prisma.supplier.create({
        data: {
          ...s,
          status: "APPROVED",
          publicVisible: true,
          bankInfoStatus: "ON_FILE",
          bankInfoNote: "Seeded demo supplier.",
          bankInfoUpdatedAt: new Date(),
        },
      });
    }
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

  // Seed real product photos from seed-images.json. Idempotent top-up:
  // - URLs already in the DB are left alone (preserves any supplier-uploaded
  //   images that were positioned after the seeded ones).
  // - URLs in the JSON that AREN'T in the DB yet get inserted at the next
  //   open position. So adding a second photo for a SKU that previously
  //   only had one will land on the next deploy.
  // - Position 0 (the primary) is enforced: if the JSON's first URL is in
  //   the DB but not at position 0, we leave the existing order alone (so
  //   supplier-reorders are preserved).
  try {
    const raw = await readFile(join(__dirname, "seed-images.json"), "utf-8");
    const mapping = JSON.parse(raw);
    let inserted = 0;
    let toppedUp = 0;
    let skippedNoUrls = 0;
    for (const [sku, urls] of Object.entries(mapping)) {
      if (sku.startsWith("_")) continue;
      if (!Array.isArray(urls) || urls.length === 0) {
        skippedNoUrls++;
        continue;
      }
      const product = await prisma.product.findUnique({ where: { sku } });
      if (!product) continue;
      const existing = await prisma.productImage.findMany({
        where: { productId: product.id },
        orderBy: { position: "asc" },
      });
      const existingUrlSet = new Set(existing.map((e) => e.url));
      let nextPos = existing.length;
      let addedThisSku = 0;
      for (const raw of urls) {
        const url = String(raw).trim();
        if (!url) continue;
        if (existingUrlSet.has(url)) continue;
        await prisma.productImage.create({
          data: { productId: product.id, url, position: nextPos++ },
        });
        addedThisSku++;
      }
      // Sync the legacy single-image field with whatever is at position 0.
      const first = existing[0]?.url ?? String(urls[0]).trim();
      if (first && first !== product.imageUrl) {
        await prisma.product.update({
          where: { id: product.id },
          data: { imageUrl: first },
        });
      }
      if (addedThisSku > 0 && existing.length === 0) inserted++;
      else if (addedThisSku > 0) toppedUp++;
    }
    console.log(
      "Seed images: inserted",
      inserted,
      "new SKUs,",
      "topped-up",
      toppedUp,
      "existing SKUs,",
      skippedNoUrls,
      "had no URLs."
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

  // --- Backfill any Shipped/Delivered orders that are missing carrier or
  // trackingCode (can happen when a test path advances an order through
  // /ops without filling in the fields). Without these the buyer's order
  // page hides the tracking card on first login. ---
  const ordersMissingTracking = await prisma.order.findMany({
    where: {
      shipmentStage: { in: ["Shipped", "Delivered"] },
      OR: [
        { carrier: null },
        { carrier: "" },
        { trackingCode: null },
        { trackingCode: "" },
      ],
    },
    select: { id: true, reference: true, carrier: true, trackingCode: true },
  });
  for (let i = 0; i < ordersMissingTracking.length; i++) {
    const o = ordersMissingTracking[i];
    await prisma.order.update({
      where: { id: o.id },
      data: {
        carrier: o.carrier || (i % 2 === 0 ? "FedEx Freight" : "UPS"),
        trackingCode:
          o.trackingCode ||
          `1Z${Math.random().toString(36).toUpperCase().slice(2, 8)}${(1000 + i).toString().padStart(4, "0")}`,
      },
    });
  }
  if (ordersMissingTracking.length > 0) {
    console.log(
      "Seed: backfilled carrier/tracking on",
      ordersMissingTracking.length,
      "Shipped/Delivered orders that were missing it."
    );
  }

  // --- Demo supplier applications. Idempotent: only seed when zero PENDING
  // applications exist, so admin can demo the approve/reject workflow. ---
  const pendingApps = await prisma.supplierApplication.count({
    where: { status: "PENDING" },
  });
  if (pendingApps === 0) {
    await prisma.supplierApplication.createMany({
      data: [
        {
          companyName: "Northern Lattice Power Systems",
          contactName: "Maya Hernandez",
          email: "maya@northernlatticepower.example",
          website: "https://northernlatticepower.example",
          category: "Transformers",
          yearsTrading: "18",
          certs: "ISO 9001:2015, IEEE C57 compliant, authorized Howard distributor",
          message:
            "Pad-mount transformers and substation gear for upper-midwest co-ops. We've been quoting through the channel for years and would like the demand visibility PartsPort offers.",
          status: "PENDING",
        },
        {
          companyName: "Coastline Switchgear & Supply",
          contactName: "Devon Park",
          email: "devon@coastlineswitch.example",
          website: "https://coastlineswitch.example",
          category: "Switchgear & Breakers",
          yearsTrading: "11",
          certs: "ISO 9001:2015, ANSI C37 type-tested, NETA-certified field service",
          message:
            "Specialize in medium-voltage switchgear retrofits for municipal utilities along the Eastern Seaboard. Looking to add a digital sales channel.",
          status: "PENDING",
        },
        {
          companyName: "HighPlains Renewables Distributors",
          contactName: "Jamie Sokolov",
          email: "jamie@highplainsrenew.example",
          website: "https://highplainsrenew.example",
          category: "Solar & Inverters",
          yearsTrading: "7",
          certs: "ISO 9001:2015, NABCEP partner, Enphase + SMA authorized",
          message:
            "Commercial PV and storage components, stocked in Denver and Albuquerque. Would like to test PartsPort for buyers in the lower-volume long tail we can't cover with our outside-sales team.",
          status: "PENDING",
        },
      ],
    });
  }

  // --- Demo orders + RFQs for the buyer demo account. Idempotent: skip if
  // the buyer already has any orders / quotes seeded. ---
  const buyer = await prisma.user.findUnique({
    where: { email: "buyer@partsport.example" },
  });
  if (buyer) {
    // Per-state top-up. Previously gated on existingOrderCount === 0, which
    // skipped EVERYTHING when the buyer had any test orders (and the test
    // teams routinely create PENDING orders by clicking through Buy). Now
    // we top up each state independently so the demo can always show a
    // Shipped order with tracking and a Delivered order ready for review.
    await seedDemoOrders(buyer);
    await seedDemoQuotes(buyer);
  }

  console.log(
    "Seed complete:",
    SUPPLIERS.length,
    "suppliers,",
    PRODUCTS.length,
    "products, 5 demo users."
  );
}

const FEE_BPS = 600; // matches src/lib/money.ts FEE_RATE_BPS

function refCode(prefix) {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 6; i++)
    s += chars[Math.floor(Math.random() * chars.length)];
  return `${prefix}-${s}`;
}

/** Pick a product by SKU; returns null if it was removed from the catalog. */
async function getProductBySku(sku) {
  return prisma.product.findUnique({
    where: { sku },
    include: { supplier: true },
  });
}

async function seedDemoOrders(buyer) {
  // Order A: small PENDING order so the buyer can immediately test the
  // payment flow on /orders/[id]. Skip if any PENDING order already exists.
  const hasPending = await prisma.order.count({
    where: { buyerId: buyer.id, status: "PENDING" },
  });
  const pendingProd = await getProductBySku("SAF-AFK12");
  if (hasPending === 0 && pendingProd) {
    const subtotal = pendingProd.priceCents * 2;
    const fee = Math.round((subtotal * FEE_BPS) / 10000);
    const total = subtotal + fee;
    await prisma.order.create({
      data: {
        reference: refCode("PP"),
        status: "PENDING",
        buyerId: buyer.id,
        buyerName: buyer.name,
        buyerEmail: buyer.email,
        shipTo: "1500 Industrial Way, Bend, OR 97701",
        subtotalCents: subtotal,
        freightCents: 0,
        feeCents: fee,
        taxCents: 0,
        totalCents: total,
        feeRateBps: FEE_BPS,
        items: {
          create: [
            {
              productId: pendingProd.id,
              nameSnapshot: pendingProd.name,
              skuSnapshot: pendingProd.sku,
              supplierName: pendingProd.supplier.name,
              unitPriceCents: pendingProd.priceCents,
              qty: 2,
            },
          ],
        },
      },
    });
  }

  // Order B: PAID and currently Shipped with a carrier and tracking code, so
  // the buyer can test the timeline, the tracking link, and the in-thread
  // messaging flow. Skip if any Shipped order already exists for the buyer.
  const hasShipped = await prisma.order.count({
    where: {
      buyerId: buyer.id,
      status: "PAID",
      shipmentStage: "Shipped",
    },
  });
  const shippedProd = await getProductBySku("RLY-SEL751");
  if (hasShipped === 0 && shippedProd) {
    const subtotal = shippedProd.priceCents * 1;
    const fee = Math.round((subtotal * FEE_BPS) / 10000);
    const total = subtotal + fee;
    const placed = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000); // 6 days ago
    const paid = new Date(placed.getTime() + 30 * 60 * 1000);
    const reference = refCode("PP");
    const created = await prisma.order.create({
      data: {
        reference,
        status: "PAID",
        buyerId: buyer.id,
        buyerName: buyer.name,
        buyerEmail: buyer.email,
        shipTo: "1500 Industrial Way, Bend, OR 97701",
        subtotalCents: subtotal,
        freightCents: 0,
        feeCents: fee,
        taxCents: 0,
        totalCents: total,
        feeRateBps: FEE_BPS,
        paymentMethod: "stripe (demo)",
        createdAt: placed,
        paidAt: paid,
        shipmentStage: "Shipped",
        carrier: "UPS",
        trackingCode: "1Z999AA10123456784",
        items: {
          create: [
            {
              productId: shippedProd.id,
              nameSnapshot: shippedProd.name,
              skuSnapshot: shippedProd.sku,
              supplierName: shippedProd.supplier.name,
              unitPriceCents: shippedProd.priceCents,
              qty: 1,
            },
          ],
        },
      },
    });
    // Auto-issue the invoice so the invoice page is testable too.
    await prisma.invoice.upsert({
      where: { orderId: created.id },
      update: {},
      create: {
        number: `INV-${reference}`,
        orderId: created.id,
        status: "PAID",
        subtotalCents: subtotal,
        freightCents: 0,
        feeCents: fee,
        taxCents: 0,
        totalCents: total,
        buyerName: buyer.name,
        buyerEmail: buyer.email,
        shipTo: "1500 Industrial Way, Bend, OR 97701",
      },
    });
    // Drop a sample thread message so the message UI is populated.
    await prisma.message.create({
      data: {
        orderId: created.id,
        senderName: shippedProd.supplier.name,
        senderEmail: shippedProd.supplier.contactEmail,
        senderRole: "SUPPLIER",
        body: `Tracking is now live with UPS. ETA per the carrier is 2-3 business days. We are happy to answer any questions on configuration before you install.`,
      },
    });
  }

  // Order C: FULFILLED so the buyer can post a review and (if needed)
  // open a return. Skip if any FULFILLED/Delivered order already exists.
  const hasDelivered = await prisma.order.count({
    where: {
      buyerId: buyer.id,
      OR: [{ status: "FULFILLED" }, { shipmentStage: "Delivered" }],
    },
  });
  const deliveredProd = await getProductBySku("LNH-INS15P");
  if (hasDelivered === 0 && deliveredProd) {
    const subtotal = deliveredProd.priceCents * 12;
    const fee = Math.round((subtotal * FEE_BPS) / 10000);
    const total = subtotal + fee;
    const placed = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
    const paid = new Date(placed.getTime() + 60 * 60 * 1000);
    const reference = refCode("PP");
    const created = await prisma.order.create({
      data: {
        reference,
        status: "FULFILLED",
        buyerId: buyer.id,
        buyerName: buyer.name,
        buyerEmail: buyer.email,
        shipTo: "1500 Industrial Way, Bend, OR 97701",
        subtotalCents: subtotal,
        freightCents: 0,
        feeCents: fee,
        taxCents: 0,
        totalCents: total,
        feeRateBps: FEE_BPS,
        paymentMethod: "stripe (demo)",
        createdAt: placed,
        paidAt: paid,
        shipmentStage: "Delivered",
        carrier: "FedEx",
        trackingCode: "789456123456",
        items: {
          create: [
            {
              productId: deliveredProd.id,
              nameSnapshot: deliveredProd.name,
              skuSnapshot: deliveredProd.sku,
              supplierName: deliveredProd.supplier.name,
              unitPriceCents: deliveredProd.priceCents,
              qty: 12,
            },
          ],
        },
      },
    });
    await prisma.invoice.upsert({
      where: { orderId: created.id },
      update: {},
      create: {
        number: `INV-${reference}`,
        orderId: created.id,
        status: "PAID",
        subtotalCents: subtotal,
        freightCents: 0,
        feeCents: fee,
        taxCents: 0,
        totalCents: total,
        buyerName: buyer.name,
        buyerEmail: buyer.email,
        shipTo: "1500 Industrial Way, Bend, OR 97701",
      },
    });
  }
}

async function seedDemoQuotes(buyer) {
  // Quote 1: OPEN (awaiting supplier response). Skip if buyer already has
  // any OPEN quote.
  const hasOpen = await prisma.quoteRequest.count({
    where: { buyerId: buyer.id, status: "OPEN" },
  });
  const openProd = await getProductBySku("TXF-PM75");
  if (hasOpen === 0 && openProd) {
    await prisma.quoteRequest.create({
      data: {
        reference: refCode("RFQ"),
        productId: openProd.id,
        qty: 3,
        buyerId: buyer.id,
        buyerName: buyer.name,
        buyerEmail: buyer.email,
        company: "Cascadia Rural Co-op",
        message:
          "Need three units for a feeder rebuild this fall. Can you confirm delivery to OR 97701 and whether the radial-feed bushing option is in stock?",
        status: "OPEN",
      },
    });
  }
  // Quote 2: QUOTED (supplier has responded, waiting on buyer accept).
  // Skip if buyer already has any QUOTED quote.
  const hasQuoted = await prisma.quoteRequest.count({
    where: { buyerId: buyer.id, status: "QUOTED" },
  });
  const quotedProd = await getProductBySku("GEN-DIESEL100");
  if (hasQuoted === 0 && quotedProd) {
    const created = await prisma.quoteRequest.create({
      data: {
        reference: refCode("RFQ"),
        productId: quotedProd.id,
        qty: 1,
        buyerId: buyer.id,
        buyerName: buyer.name,
        buyerEmail: buyer.email,
        company: "Cascadia Rural Co-op",
        message:
          "One unit for a critical-load installation. Need sub-base tank and a load-bank test at the factory.",
        status: "QUOTED",
        quotedUnitCents: 3120000,
        quoteNote:
          "Factory load-bank test included. Sub-base tank rated for 24 hr runtime. Lead time 8 weeks from PO.",
        quotedAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000),
      },
    });
    // Add a sample message from the supplier on the quote thread.
    await prisma.message.create({
      data: {
        quoteId: created.id,
        senderName: quotedProd.supplier.name,
        senderEmail: quotedProd.supplier.contactEmail,
        senderRole: "SUPPLIER",
        body:
          "Quote is firm for 30 days. Happy to walk you through the controller options on a call if helpful.",
      },
    });
  }
}

main()
  .catch((e) => {
    console.error("Seed error (non-fatal):", e.message);
    process.exitCode = 0;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
