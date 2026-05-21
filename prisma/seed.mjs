import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const SUPPLIERS = [
  { name: "Hovland Bearing Supply", contactEmail: "sales@hovlandbearing.example", rating: 4.9, reviews: 312, onTimeRate: 99.1, certifications: "ISO 9001:2015, authorized SKF distributor" },
  { name: "Midwest Fluid Power", contactEmail: "orders@midwestfluid.example", rating: 4.8, reviews: 218, onTimeRate: 97.8, certifications: "ISO 9001:2015, Parker authorized" },
  { name: "Atlas Automation Parts", contactEmail: "ops@atlasautomation.example", rating: 4.7, reviews: 242, onTimeRate: 98.2, certifications: "ISO 9001:2015" },
  { name: "Northgate Electric Motor Co.", contactEmail: "sales@northgatemotor.example", rating: 4.9, reviews: 161, onTimeRate: 98.9, certifications: "ISO 9001:2015, UL-listed rewind shop" },
  { name: "Voltline Industrial", contactEmail: "desk@voltline.example", rating: 4.6, reviews: 190, onTimeRate: 96.5, certifications: "ISO 9001:2015" },
  { name: "Drive Components Direct", contactEmail: "sales@drivecomponents.example", rating: 4.8, reviews: 239, onTimeRate: 98.4, certifications: "ISO 9001:2015, Gates authorized" },
  { name: "Precision Flow Supply", contactEmail: "quotes@precisionflow.example", rating: 4.9, reviews: 183, onTimeRate: 99.0, certifications: "ISO 9001:2015, AS9100" },
  { name: "BoltBin Fasteners", contactEmail: "hello@boltbin.example", rating: 4.5, reviews: 207, onTimeRate: 95.4, certifications: "ISO 9001:2015" },
  { name: "Driveline Solutions", contactEmail: "sales@drivelinesolutions.example", rating: 4.8, reviews: 96, onTimeRate: 97.1, certifications: "ISO 9001:2015, NORD partner" },
  { name: "Edge Tooling Group", contactEmail: "orders@edgetooling.example", rating: 4.8, reviews: 78, onTimeRate: 98.0, certifications: "ISO 9001:2015" },
];

const PRODUCTS = [
  { sku: "BRG-6205-2RS", name: "Deep Groove Ball Bearing 6205-2RS", category: "Bearings", manufacturer: "SKF", icon: "bearing", price: 14.2, unit: "each", etaDays: 2, stock: 1840, supplier: "Hovland Bearing Supply", specs: { Bore: "25 mm", "Outer Dia.": "52 mm", Width: "15 mm", Seal: "Double rubber (2RS)", "Dynamic Load": "14.0 kN" }, description: "Sealed deep-groove radial ball bearing for general-purpose rotating equipment. Pre-lubricated and maintenance-free, rated for continuous duty in pumps, motors, and gearboxes." },
  { sku: "HYD-PGP505", name: "PGP505 Hydraulic Gear Pump", category: "Hydraulics", manufacturer: "Parker Hannifin", icon: "pump", price: 612.0, unit: "each", etaDays: 4, stock: 22, supplier: "Midwest Fluid Power", specs: { Displacement: "5.2 cc/rev", "Max Pressure": "250 bar", "Max Speed": "4000 rpm", Port: "SAE 8 / SAE 10", Rotation: "Clockwise" }, description: "High-efficiency cast-iron gear pump for mobile and industrial hydraulic systems. Precision-ground gears deliver stable flow under high pressure with low noise." },
  { sku: "PNE-ADN-32", name: "ADN-32 Compact Pneumatic Cylinder", category: "Pneumatics", manufacturer: "Festo", icon: "cylinder", price: 88.5, unit: "each", etaDays: 3, stock: 156, supplier: "Atlas Automation Parts", specs: { Bore: "32 mm", Stroke: "25 mm", Action: "Double-acting", "Max Pressure": "10 bar", Cushioning: "Elastic both ends" }, description: "ISO 21287 compact cylinder for tight-envelope automation. Corrosion-resistant body with magnetic piston for position sensing." },
  { sku: "MTR-VEM-5HP", name: "5 HP TEFC Three-Phase Motor", category: "Motors & Drives", manufacturer: "Baldor-Reliance", icon: "motor", price: 742.0, unit: "each", etaDays: 6, stock: 14, supplier: "Northgate Electric Motor Co.", specs: { Power: "5 HP", Voltage: "230/460 V", Speed: "1750 rpm", Frame: "184T", Enclosure: "TEFC", Efficiency: "NEMA Premium" }, description: "Totally enclosed fan-cooled industrial motor with cast-iron frame. NEMA Premium efficiency for compressors, conveyors, and pumps in dusty or washdown environments." },
  { sku: "ELC-3RT2-25", name: "SIRIUS 3RT2 Power Contactor 25A", category: "Electrical", manufacturer: "Siemens", icon: "contactor", price: 63.75, unit: "each", etaDays: 2, stock: 410, supplier: "Voltline Industrial", specs: { "Rated Current": "25 A", "Coil Voltage": "24 V DC", Poles: "3", "AC-3 Power": "11 kW @ 400V", Mounting: "35 mm DIN rail" }, description: "Compact 3-pole contactor for motor switching and control panels. Spring-loaded terminals speed up wiring and resist vibration loosening." },
  { sku: "BLT-GT3-640", name: "PowerGrip GT3 Timing Belt 640-8M", category: "Belts & Pulleys", manufacturer: "Gates", icon: "belt", price: 31.4, unit: "each", etaDays: 2, stock: 520, supplier: "Drive Components Direct", specs: { Pitch: "8 mm (8M)", Length: "640 mm", Width: "20 mm", Teeth: "80", Material: "Fiberglass-reinforced neoprene" }, description: "Curvilinear-tooth synchronous belt for high-torque, zero-slip power transmission. Quiet running with long service life on indexing and positioning drives." },
  { sku: "SEN-Q4X-LDS", name: "Q4X Laser Distance Sensor", category: "Sensors", manufacturer: "Banner Engineering", icon: "sensor", price: 245.0, unit: "each", etaDays: 5, stock: 73, supplier: "Atlas Automation Parts", specs: { Range: "25 - 300 mm", Output: "PNP / NPN + analog", Rating: "IP67 / IP69K", Response: "1.5 ms", Housing: "Stainless steel" }, description: "Rugged laser measurement sensor that detects targets regardless of color, gloss, or angle. Ideal for clear-object and small-part detection." },
  { sku: "VLV-SS-BV12", name: '316SS Ball Valve, 1/2" NPT', category: "Valves", manufacturer: "Swagelok", icon: "valve", price: 97.3, unit: "each", etaDays: 3, stock: 198, supplier: "Precision Flow Supply", specs: { Size: "1/2 in.", End: "NPT female", Body: "316 stainless steel", Seat: "PTFE", "Max Pressure": "2200 psi" }, description: "Full-port two-way ball valve for instrumentation and process lines. Live-loaded stem packing maintains a leak-tight seal across temperature cycles." },
  { sku: "FST-G8-KIT250", name: "Grade 8 Hex Cap Screw Kit, 250 pc", category: "Fasteners", manufacturer: "Fastenal", icon: "bolt", price: 48.9, unit: "per kit", etaDays: 1, stock: 305, supplier: "BoltBin Fasteners", specs: { Grade: "SAE Grade 8", Sizes: '1/4" - 1/2" assorted', Finish: "Yellow zinc", Thread: "UNC", Count: "250 pieces" }, description: "Shop-replenishment assortment of high-tensile hex cap screws in a labeled organizer case. Covers the most common maintenance and assembly sizes." },
  { sku: "PTX-SK9032", name: "SK 9032 Helical Inline Gearbox", category: "Power Transmission", manufacturer: "NORD Drivesystems", icon: "gear", price: 1180.0, unit: "each", etaDays: 9, stock: 8, supplier: "Driveline Solutions", specs: { Ratio: "15.71:1", "Output Torque": "450 Nm", Stages: "2", Housing: "UNICASE one-piece", Mount: "Foot + flange" }, description: "One-piece-housing helical reducer engineered for quiet, high-efficiency torque conversion on conveyors, mixers, and material-handling drives." },
  { sku: "PTX-L095", name: "L-095 Jaw Coupling, Complete", category: "Power Transmission", manufacturer: "Lovejoy", icon: "coupling", price: 22.1, unit: "each", etaDays: 2, stock: 640, supplier: "Drive Components Direct", specs: { Type: "Curved-jaw flexible", "Max Bore": "1.125 in.", "Rated Torque": "136 in-lb", Element: "NBR rubber (SOX)", "Max Speed": "11000 rpm" }, description: "Maintenance-free flexible coupling that dampens shock and accommodates shaft misalignment. Includes both hubs and the elastomeric spider." },
  { sku: "SEL-BG3000", name: 'Blue-Gard 3000 Gasket Sheet, 1/16"', category: "Seals & Gaskets", manufacturer: "Garlock", icon: "gasket", price: 54.0, unit: "per sheet", etaDays: 4, stock: 132, supplier: "Precision Flow Supply", specs: { Thickness: "1/16 in.", "Sheet Size": "15 x 15 in.", Material: "Aramid fiber / NBR binder", "Max Temp": "700 F", "Max Pressure": "1200 psi" }, description: "Cut-to-fit compressed sheet gasketing for flanged joints handling water, steam, oils, and mild chemicals. Excellent torque retention and sealability." },
  { sku: "CUT-CNMG-10", name: "CNMG 432 Carbide Turning Insert, 10 pk", category: "Cutting Tools", manufacturer: "Sandvik Coromant", icon: "insert", price: 112.0, unit: "per 10-pack", etaDays: 3, stock: 240, supplier: "Edge Tooling Group", specs: { Geometry: "CNMG 120408", Grade: "GC4325 (P25)", Coating: "CVD multilayer", Application: "Steel turning", Pack: "10 inserts" }, description: "Coated carbide negative inserts for medium turning of steel. Tough substrate and wear-resistant coating extend tool life at production feed rates." },
  { sku: "MTR-PF525-3", name: "PowerFlex 525 AC Drive, 3 HP", category: "Motors & Drives", manufacturer: "Allen-Bradley", icon: "vfd", price: 498.0, unit: "each", etaDays: 5, stock: 19, supplier: "Voltline Industrial", specs: { Power: "3 HP / 2.2 kW", Input: "480 V, 3-phase", Control: "V/Hz + sensorless vector", Network: "EtherNet/IP built-in", Enclosure: "IP20" }, description: "Compact variable-frequency drive with modular design for fast install and replacement. Built-in safety and EtherNet/IP for connected motor control." },
  { sku: "HYD-HSE38-2W", name: '3/8" 2-Wire Hydraulic Hose Assembly', category: "Hydraulics", manufacturer: "Eaton Aeroquip", icon: "hose", price: 9.8, unit: "per ft", etaDays: 2, stock: 2600, supplier: "Midwest Fluid Power", specs: { ID: "3/8 in.", Construction: "2-wire braid", "Max Pressure": "3625 psi", Spec: "SAE 100R2AT", Fittings: "Crimped JIC, included" }, description: "Cut-to-length hydraulic hose assemblies crimped with JIC fittings to your specified length. Abrasion-resistant cover for mobile and plant equipment." },
  { sku: "SEN-E3Z-D", name: "E3Z Photoelectric Sensor, Diffuse", category: "Sensors", manufacturer: "Omron", icon: "sensor", price: 58.4, unit: "each", etaDays: 3, stock: 0, supplier: "Atlas Automation Parts", specs: { Type: "Diffuse reflective", Range: "100 mm", Output: "NPN", Rating: "IP67", "Light Source": "Red LED" }, description: "Compact photoelectric sensor for presence detection on conveyors and machine guarding. Bright alignment indicator simplifies setup." },
];

async function main() {
  // Seed is idempotent and non-destructive: it only fills an empty database
  // and never overwrites edits made through the dashboards on redeploy.
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
      update: {},
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
        description: p.description,
        specs: p.specs,
        supplierId: supplierIds[p.supplier],
        active: true,
      },
    });
  }

  const pw = await bcrypt.hash("demo1234", 10);
  const demoUsers = [
    { email: "admin@partsport.example", name: "Avery Ops", role: "ADMIN" },
    { email: "buyer@partsport.example", name: "Jordan Buyer", role: "BUYER" },
  ];
  for (const u of demoUsers) {
    await prisma.user.upsert({
      where: { email: u.email },
      update: {},
      create: { ...u, passwordHash: pw },
    });
  }

  // Supplier demo account linked to Atlas Automation Parts
  const atlasId = supplierIds["Atlas Automation Parts"];
  const supplierUser = await prisma.user.upsert({
    where: { email: "supplier@partsport.example" },
    update: {},
    create: {
      email: "supplier@partsport.example",
      name: "Sam Atlas",
      role: "SUPPLIER",
      passwordHash: pw,
    },
  });
  const atlas = await prisma.supplier.findUnique({ where: { id: atlasId } });
  if (atlas && !atlas.userId) {
    await prisma.supplier.update({
      where: { id: atlasId },
      data: { userId: supplierUser.id },
    });
  }

  console.log("Seed complete:", SUPPLIERS.length, "suppliers,", PRODUCTS.length, "products, 3 demo users.");
}

main()
  .catch((e) => {
    console.error("Seed error (non-fatal):", e.message);
    process.exitCode = 0;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
