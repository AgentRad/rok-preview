/* PartsPort — mock catalog data + inline SVG part illustrations.
   Standalone demo data; no backend. */

(function (global) {
  'use strict';

  /* ---- Line-art illustrations (technical-drawing style) ---- */
  function svg(inner) {
    return '<svg viewBox="0 0 64 64" role="img" aria-hidden="true" fill="none" ' +
      'stroke="#3d4655" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">' +
      inner + '</svg>';
  }

  var ART = {
    bearing: svg(
      '<circle cx="32" cy="32" r="22"/><circle cx="32" cy="32" r="9"/>' +
      '<circle cx="32" cy="11.5" r="3.4"/><circle cx="46.5" cy="17.5" r="3.4"/>' +
      '<circle cx="52.5" cy="32" r="3.4"/><circle cx="46.5" cy="46.5" r="3.4"/>' +
      '<circle cx="32" cy="52.5" r="3.4"/><circle cx="17.5" cy="46.5" r="3.4"/>' +
      '<circle cx="11.5" cy="32" r="3.4"/><circle cx="17.5" cy="17.5" r="3.4"/>'),
    pump: svg(
      '<rect x="12" y="20" width="40" height="28" rx="3"/>' +
      '<circle cx="26" cy="34" r="8"/><circle cx="40" cy="34" r="8"/>' +
      '<rect x="28" y="10" width="8" height="10" rx="1"/>' +
      '<path d="M12 44h-4M52 44h4"/>'),
    cylinder: svg(
      '<rect x="8" y="24" width="32" height="16" rx="2"/>' +
      '<path d="M40 32h12"/><rect x="52" y="27" width="5" height="10" rx="1"/>' +
      '<path d="M14 24v-5M22 24v-5M30 24v-5"/>'),
    motor: svg(
      '<rect x="12" y="20" width="32" height="26" rx="3"/>' +
      '<path d="M44 33h13"/>' +
      '<path d="M18 20v26M24 20v26M30 20v26M36 20v26" stroke-width="1.6"/>' +
      '<path d="M16 46v5h6v-5M34 46v5h6v-5"/>'),
    contactor: svg(
      '<rect x="18" y="16" width="28" height="32" rx="2"/>' +
      '<path d="M24 16v-6M32 16v-6M40 16v-6M24 48v6M32 48v6M40 48v6"/>' +
      '<path d="M24 30h16" stroke-width="1.6"/>'),
    belt: svg(
      '<circle cx="21" cy="32" r="11"/><circle cx="45" cy="32" r="9"/>' +
      '<circle cx="21" cy="32" r="3"/><circle cx="45" cy="32" r="3"/>' +
      '<path d="M21 21h24M21 43h24"/>'),
    sensor: svg(
      '<rect x="9" y="22" width="20" height="20" rx="2"/>' +
      '<path d="M29 32h26" stroke-dasharray="3 4"/>' +
      '<path d="M55 23v18"/><path d="M14 22v-4M24 22v-4"/>'),
    valve: svg(
      '<path d="M12 22v20l20-10zM52 22v20L32 32z"/>' +
      '<path d="M32 32V14"/><ellipse cx="32" cy="12" rx="13" ry="4.5"/>' +
      '<path d="M12 32H6M52 32h6"/>'),
    bolt: svg(
      '<path d="M20 19l12 7v12l-12 7-12-7V26z"/>' +
      '<path d="M32 27h22v10H32"/>' +
      '<path d="M38 27v10M44 27v10M50 27v10" stroke-width="1.6"/>'),
    gear: svg(
      '<circle cx="32" cy="32" r="14"/><circle cx="32" cy="32" r="6"/>' +
      '<g stroke-width="2.4">' +
      '<rect x="29" y="9" width="6" height="9"/>' +
      '<rect x="29" y="46" width="6" height="9"/>' +
      '<rect x="9" y="29" width="9" height="6"/>' +
      '<rect x="46" y="29" width="9" height="6"/>' +
      '<rect x="29" y="9" width="6" height="9" transform="rotate(45 32 32)"/>' +
      '<rect x="29" y="46" width="6" height="9" transform="rotate(45 32 32)"/>' +
      '<rect x="9" y="29" width="9" height="6" transform="rotate(45 32 32)"/>' +
      '<rect x="46" y="29" width="9" height="6" transform="rotate(45 32 32)"/></g>'),
    coupling: svg(
      '<rect x="11" y="18" width="16" height="28" rx="2"/>' +
      '<rect x="37" y="18" width="16" height="28" rx="2"/>' +
      '<path d="M27 26h10M27 38h10"/><path d="M19 18v-4M45 18v-4"/>'),
    gasket: svg(
      '<rect x="10" y="10" width="44" height="44" rx="3"/>' +
      '<circle cx="32" cy="32" r="13"/>' +
      '<circle cx="18" cy="18" r="2.6"/><circle cx="46" cy="18" r="2.6"/>' +
      '<circle cx="18" cy="46" r="2.6"/><circle cx="46" cy="46" r="2.6"/>'),
    insert: svg(
      '<path d="M32 11l21 21-21 21-21-21z"/><circle cx="32" cy="32" r="6"/>'),
    hose: svg(
      '<path d="M12 46C16 18 30 50 36 30s14-6 16-14"/>' +
      '<rect x="8" y="42" width="9" height="9" rx="1"/>' +
      '<rect x="48" y="11" width="9" height="9" rx="1"/>'),
    vfd: svg(
      '<rect x="14" y="11" width="30" height="42" rx="3"/>' +
      '<rect x="20" y="17" width="18" height="9" rx="1"/>' +
      '<circle cx="24" cy="38" r="3"/><circle cx="34" cy="38" r="3"/>' +
      '<path d="M44 18v28M49 18v28M54 18v28" stroke-width="1.6"/>')
  };

  /* ---- Catalog ---- */
  var PRODUCTS = [
    {
      sku: 'BRG-6205-2RS', name: 'Deep Groove Ball Bearing 6205-2RS',
      category: 'Bearings', manufacturer: 'SKF', icon: 'bearing',
      price: 14.20, unit: 'each', etaDays: 2, stock: 1840,
      supplier: 'Hovland Bearing Supply', rating: 4.9, reviews: 312,
      specs: { 'Bore': '25 mm', 'Outer Dia.': '52 mm', 'Width': '15 mm', 'Seal': 'Double rubber (2RS)', 'Dynamic Load': '14.0 kN' },
      desc: 'Sealed deep-groove radial ball bearing for general-purpose rotating equipment. Pre-lubricated and maintenance-free, rated for continuous duty in pumps, motors, and gearboxes.'
    },
    {
      sku: 'HYD-PGP505', name: 'PGP505 Hydraulic Gear Pump',
      category: 'Hydraulics', manufacturer: 'Parker Hannifin', icon: 'pump',
      price: 612.00, unit: 'each', etaDays: 4, stock: 22,
      supplier: 'Midwest Fluid Power', rating: 4.8, reviews: 47,
      specs: { 'Displacement': '5.2 cc/rev', 'Max Pressure': '250 bar', 'Max Speed': '4000 rpm', 'Port': 'SAE 8 / SAE 10', 'Rotation': 'Clockwise' },
      desc: 'High-efficiency cast-iron gear pump for mobile and industrial hydraulic systems. Precision-ground gears deliver stable flow under high pressure with low noise.'
    },
    {
      sku: 'PNE-ADN-32', name: 'ADN-32 Compact Pneumatic Cylinder',
      category: 'Pneumatics', manufacturer: 'Festo', icon: 'cylinder',
      price: 88.50, unit: 'each', etaDays: 3, stock: 156,
      supplier: 'Atlas Automation Parts', rating: 4.7, reviews: 88,
      specs: { 'Bore': '32 mm', 'Stroke': '25 mm', 'Action': 'Double-acting', 'Max Pressure': '10 bar', 'Cushioning': 'Elastic both ends' },
      desc: 'ISO 21287 compact cylinder for tight-envelope automation. Corrosion-resistant body with magnetic piston for position sensing.'
    },
    {
      sku: 'MTR-VEM-5HP', name: '5 HP TEFC Three-Phase Motor',
      category: 'Motors & Drives', manufacturer: 'Baldor-Reliance', icon: 'motor',
      price: 742.00, unit: 'each', etaDays: 6, stock: 14,
      supplier: 'Northgate Electric Motor Co.', rating: 4.9, reviews: 61,
      specs: { 'Power': '5 HP', 'Voltage': '230/460 V', 'Speed': '1750 rpm', 'Frame': '184T', 'Enclosure': 'TEFC', 'Efficiency': 'NEMA Premium' },
      desc: 'Totally enclosed fan-cooled industrial motor with cast-iron frame. NEMA Premium efficiency for compressors, conveyors, and pumps in dusty or washdown environments.'
    },
    {
      sku: 'ELC-3RT2-25', name: 'SIRIUS 3RT2 Power Contactor 25A',
      category: 'Electrical', manufacturer: 'Siemens', icon: 'contactor',
      price: 63.75, unit: 'each', etaDays: 2, stock: 410,
      supplier: 'Voltline Industrial', rating: 4.6, reviews: 134,
      specs: { 'Rated Current': '25 A', 'Coil Voltage': '24 V DC', 'Poles': '3', 'AC-3 Power': '11 kW @ 400V', 'Mounting': '35 mm DIN rail' },
      desc: 'Compact 3-pole contactor for motor switching and control panels. Spring-loaded terminals speed up wiring and resist vibration loosening.'
    },
    {
      sku: 'BLT-GT3-640', name: 'PowerGrip GT3 Timing Belt 640-8M',
      category: 'Belts & Pulleys', manufacturer: 'Gates', icon: 'belt',
      price: 31.40, unit: 'each', etaDays: 2, stock: 520,
      supplier: 'Drive Components Direct', rating: 4.8, reviews: 96,
      specs: { 'Pitch': '8 mm (8M)', 'Length': '640 mm', 'Width': '20 mm', 'Teeth': '80', 'Material': 'Fiberglass-reinforced neoprene' },
      desc: 'Curvilinear-tooth synchronous belt for high-torque, zero-slip power transmission. Quiet running with long service life on indexing and positioning drives.'
    },
    {
      sku: 'SEN-Q4X-LDS', name: 'Q4X Laser Distance Sensor',
      category: 'Sensors', manufacturer: 'Banner Engineering', icon: 'sensor',
      price: 245.00, unit: 'each', etaDays: 5, stock: 73,
      supplier: 'Atlas Automation Parts', rating: 4.7, reviews: 52,
      specs: { 'Range': '25 – 300 mm', 'Output': 'PNP / NPN + analog', 'Rating': 'IP67 / IP69K', 'Response': '1.5 ms', 'Housing': 'Stainless steel' },
      desc: 'Rugged laser measurement sensor that detects targets regardless of color, gloss, or angle. Ideal for clear-object and small-part detection.'
    },
    {
      sku: 'VLV-SS-BV12', name: '316SS Ball Valve, 1/2" NPT',
      category: 'Valves', manufacturer: 'Swagelok', icon: 'valve',
      price: 97.30, unit: 'each', etaDays: 3, stock: 198,
      supplier: 'Precision Flow Supply', rating: 4.9, reviews: 119,
      specs: { 'Size': '1/2 in.', 'End': 'NPT female', 'Body': '316 stainless steel', 'Seat': 'PTFE', 'Max Pressure': '2200 psi' },
      desc: 'Full-port two-way ball valve for instrumentation and process lines. Live-loaded stem packing maintains a leak-tight seal across temperature cycles.'
    },
    {
      sku: 'FST-G8-KIT250', name: 'Grade 8 Hex Cap Screw Kit, 250 pc',
      category: 'Fasteners', manufacturer: 'Fastenal', icon: 'bolt',
      price: 48.90, unit: 'per kit', etaDays: 1, stock: 305,
      supplier: 'BoltBin Fasteners', rating: 4.5, reviews: 207,
      specs: { 'Grade': 'SAE Grade 8', 'Sizes': '1/4" – 1/2" assorted', 'Finish': 'Yellow zinc', 'Thread': 'UNC', 'Count': '250 pieces' },
      desc: 'Shop-replenishment assortment of high-tensile hex cap screws in a labeled organizer case. Covers the most common maintenance and assembly sizes.'
    },
    {
      sku: 'PTX-SK9032', name: 'SK 9032 Helical Inline Gearbox',
      category: 'Power Transmission', manufacturer: 'NORD Drivesystems', icon: 'gear',
      price: 1180.00, unit: 'each', etaDays: 9, stock: 8,
      supplier: 'Driveline Solutions', rating: 4.8, reviews: 29,
      specs: { 'Ratio': '15.71:1', 'Output Torque': '450 Nm', 'Stages': '2', 'Housing': 'UNICASE one-piece', 'Mount': 'Foot + flange' },
      desc: 'One-piece-housing helical reducer engineered for quiet, high-efficiency torque conversion on conveyors, mixers, and material-handling drives.'
    },
    {
      sku: 'PTX-L095', name: 'L-095 Jaw Coupling, Complete',
      category: 'Power Transmission', manufacturer: 'Lovejoy', icon: 'coupling',
      price: 22.10, unit: 'each', etaDays: 2, stock: 640,
      supplier: 'Drive Components Direct', rating: 4.7, reviews: 143,
      specs: { 'Type': 'Curved-jaw flexible', 'Max Bore': '1.125 in.', 'Rated Torque': '136 in-lb', 'Element': 'NBR rubber (SOX)', 'Max Speed': '11000 rpm' },
      desc: 'Maintenance-free flexible coupling that dampens shock and accommodates shaft misalignment. Includes both hubs and the elastomeric spider.'
    },
    {
      sku: 'SEL-BG3000', name: 'Blue-Gard 3000 Gasket Sheet, 1/16"',
      category: 'Seals & Gaskets', manufacturer: 'Garlock', icon: 'gasket',
      price: 54.00, unit: 'per sheet', etaDays: 4, stock: 132,
      supplier: 'Precision Flow Supply', rating: 4.6, reviews: 64,
      specs: { 'Thickness': '1/16 in.', 'Sheet Size': '15 x 15 in.', 'Material': 'Aramid fiber / NBR binder', 'Max Temp': '700 °F', 'Max Pressure': '1200 psi' },
      desc: 'Cut-to-fit compressed sheet gasketing for flanged joints handling water, steam, oils, and mild chemicals. Excellent torque retention and sealability.'
    },
    {
      sku: 'CUT-CNMG-10', name: 'CNMG 432 Carbide Turning Insert, 10 pk',
      category: 'Cutting Tools', manufacturer: 'Sandvik Coromant', icon: 'insert',
      price: 112.00, unit: 'per 10-pack', etaDays: 3, stock: 240,
      supplier: 'Edge Tooling Group', rating: 4.8, reviews: 78,
      specs: { 'Geometry': 'CNMG 120408', 'Grade': 'GC4325 (P25)', 'Coating': 'CVD multilayer', 'Application': 'Steel turning', 'Pack': '10 inserts' },
      desc: 'Coated carbide negative inserts for medium turning of steel. Tough substrate and wear-resistant coating extend tool life at production feed rates.'
    },
    {
      sku: 'MTR-PF525-3', name: 'PowerFlex 525 AC Drive, 3 HP',
      category: 'Motors & Drives', manufacturer: 'Allen-Bradley', icon: 'vfd',
      price: 498.00, unit: 'each', etaDays: 5, stock: 19,
      supplier: 'Voltline Industrial', rating: 4.7, reviews: 56,
      specs: { 'Power': '3 HP / 2.2 kW', 'Input': '480 V, 3-phase', 'Control': 'V/Hz + sensorless vector', 'Network': 'EtherNet/IP built-in', 'Enclosure': 'IP20' },
      desc: 'Compact variable-frequency drive with modular design for fast install and replacement. Built-in safety and EtherNet/IP for connected motor control.'
    },
    {
      sku: 'HYD-HSE38-2W', name: '3/8" 2-Wire Hydraulic Hose Assembly',
      category: 'Hydraulics', manufacturer: 'Eaton Aeroquip', icon: 'hose',
      price: 9.80, unit: 'per ft', etaDays: 2, stock: 2600,
      supplier: 'Midwest Fluid Power', rating: 4.6, reviews: 171,
      specs: { 'ID': '3/8 in.', 'Construction': '2-wire braid', 'Max Pressure': '3625 psi', 'Spec': 'SAE 100R2AT', 'Fittings': 'Crimped JIC, included' },
      desc: 'Cut-to-length hydraulic hose assemblies crimped with JIC fittings to your specified length. Abrasion-resistant cover for mobile and plant equipment.'
    },
    {
      sku: 'SEN-E3Z-D', name: 'E3Z Photoelectric Sensor, Diffuse',
      category: 'Sensors', manufacturer: 'Omron', icon: 'sensor',
      price: 58.40, unit: 'each', etaDays: 3, stock: 0,
      supplier: 'Atlas Automation Parts', rating: 4.7, reviews: 102,
      specs: { 'Type': 'Diffuse reflective', 'Range': '100 mm', 'Output': 'NPN', 'Rating': 'IP67', 'Light Source': 'Red LED' },
      desc: 'Compact photoelectric sensor for presence detection on conveyors and machine guarding. Bright alignment indicator simplifies setup.'
    }
  ];

  global.PartsPort = {
    products: PRODUCTS,
    art: ART,
    iconFor: function (key) { return ART[key] || ART.gear; }
  };

})(window);
