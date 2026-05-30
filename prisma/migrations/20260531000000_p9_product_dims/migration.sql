-- Product dimensions + weight + NMFC freight class for real-rate freight
-- quoting (Shippo / EasyPost). All nullable: a supplier who hasn't filled
-- these fields in yet falls back to the deterministic lib/freight.ts
-- flat-rate calculator. Weight is in pounds, dimensions in inches (US
-- carrier convention); freight class is the NMFC code stored as a string
-- because the codes aren't sequential integers (50, 55, 60, 65, 70, 77.5,
-- 85, 92.5, 100, 110, 125, 150, 175, 200, 250, 300, 400, 500).

ALTER TABLE "Product" ADD COLUMN "weightLbs"    DOUBLE PRECISION;
ALTER TABLE "Product" ADD COLUMN "freightClass" TEXT;
ALTER TABLE "Product" ADD COLUMN "lengthIn"     DOUBLE PRECISION;
ALTER TABLE "Product" ADD COLUMN "widthIn"      DOUBLE PRECISION;
ALTER TABLE "Product" ADD COLUMN "heightIn"     DOUBLE PRECISION;
