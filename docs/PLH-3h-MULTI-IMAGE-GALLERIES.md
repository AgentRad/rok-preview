# PLH-3h — Multi-image product galleries

Paste this into a fresh build chat after PLH-3g is in flight (no
overlap, this round touches different files).

```
# CONTEXT
You're working on PartsPort at C:\Users\radfe\rok-preview, branch
claude/industrial-marketplace-ROwAU. Read CLAUDE.md, HABITS.md,
docs/ORCHESTRATOR.md.

CLAUDE.md build plan Phase J: replace Product.imageUrl single field
with a ProductImage model (ordered, multiple images per product).
Carousel on the product detail page. Supplier dashboard supports
upload/reorder/delete of multiple images. This is needed for THRADD
onboarding: real industrial equipment usually has 4 to 12 reference
photos (front, label, dimensions, mounting, in-context, datasheet
diagram).

# DELIVERABLE

1. New `ProductImage` Prisma model
2. Migration that backfills existing Product.imageUrl into a single
   ProductImage row per product
3. Supplier dashboard: per-product image manager (upload, reorder
   via drag, delete, set primary)
4. Buyer-side product detail page: carousel with thumbnail strip,
   keyboard navigation, lightbox on click
5. CSV / catalog-import path: support multiple image URLs per row
   (comma-separated or pipe-separated in a single column)
6. AI import assistant from PLH-3f: aware of the new field shape

# BUILD PLAN

## Phase 1: Schema + migration + backfill

```
model ProductImage {
  id         String   @id @default(cuid())
  productId  String
  product    Product  @relation(fields: [productId], references: [id], onDelete: Cascade)
  url        String
  alt        String   @default("")
  ordinal    Int      // 0-based; 0 is the primary
  createdAt  DateTime @default(now())

  @@index([productId, ordinal])
  @@unique([productId, ordinal])
}
```

Add `images ProductImage[]` to Product. Keep `imageUrl` as a derived
read-only field for now (computed at query time from primary
ProductImage) so consumers don't break in this phase.

Migration: backfill one ProductImage per existing Product with
ordinal=0 from current Product.imageUrl. After backfill is stable,
a later commit can drop Product.imageUrl.

Commit: "PLH-3h P1: ProductImage model + backfill from imageUrl"

## Phase 2: Supplier image manager

src/app/supplier/products/[id]/images/page.tsx (new) or extend the
existing product edit page. UI:
- Grid of current images with thumbnails
- Drag to reorder (use react-dnd if not already in deps; if not,
  arrow buttons up/down — keep it simple)
- Upload button: posts to /api/supplier/products/[id]/images POST,
  accepts a single file at a time, magic-byte MIME check (same
  pattern as OEM logo upload from PLH-2 4c), max 5 MB per image,
  max 12 images per product
- Set-as-primary button on each (swaps ordinals)
- Delete button per image

Storage: Vercel Blob, same path pattern as OEM logo. Path:
`products/${productId}_${crypto.randomBytes(8).toString("hex")}/img-${ordinal}.${ext}` (per PLH-3c F8 random suffix pattern).

Commit: "PLH-3h P2: supplier image manager UI + upload API"

## Phase 3: Buyer-side carousel

src/app/products/[slug]/page.tsx (or wherever the product detail
page lives): replace the single `<Image>` with a carousel.

Implementation: pure React + Tailwind, no carousel library.
- Main image at full size
- Thumbnail strip below
- Click thumbnail to swap main
- Arrow keys (←/→) navigate
- Click main to open lightbox (use the existing modal pattern if
  there is one, otherwise simple fixed-position overlay)
- All images lazy-loaded via next/image

For products with only one image: render the existing single-image
layout. For zero images: line-art fallback from PartIcon.tsx.

Commit: "PLH-3h P3: buyer product carousel + lightbox"

## Phase 4: CSV / catalog-import multi-image support

src/lib/csv.ts: when a CSV column is named "images" or
"image_urls", parse the value as a pipe-separated list of URLs and
create one ProductImage per URL in ordinal order.

If only a single column "imageUrl" is found, treat as a single
ProductImage (the existing path).

src/app/api/supplier/catalog-import (shipped by PLH-3f): plumb
through the multi-image field in the import preview + commit.

Commit: "PLH-3h P4: CSV import supports multi-image columns"

## Phase 5: Image deletion safety

Deleting a ProductImage should also remove its Vercel Blob asset.
Add an admin sweeper cron (daily) that finds orphaned blobs (blobs
not referenced by any ProductImage) and deletes them, with a 7-day
grace period to recover from race conditions.

Commit: "PLH-3h P5: orphan blob sweep cron"

# CROSS-CUTTING REQUIREMENTS

- Magic-byte MIME check on every upload (PNG, JPEG, WEBP only; no
  SVG, no PDF, no anything else)
- 5 MB cap per image
- 12 images cap per product
- Rate limit on the upload route (use existing `supplier` bucket)
- Audit log on every upload, delete, reorder, set-primary action
- Storage paths use random suffix (PLH-3c F8 pattern)
- npx next build passes per commit

# VERIFY

After P3 ships, manual smoke as supplier@partsport.example:
- Upload 4 images to a product
- Reorder them
- Set #3 as primary
- Confirm /products/<slug> renders the carousel with the right
  primary first
- Delete one image
- Confirm /products/<slug> still loads

# REPORTING

After each phase: HEAD hash, files changed, any surprises. After
all phases: update CLAUDE.md Status + docs/ORCHESTRATOR.md per the
standing rule. Mark Phase J as DONE in the original build plan.
```
