import Image from "next/image";
import PartIcon from "./PartIcon";

/* Renders a real product photo when available; otherwise a clean
   line-art fallback. Photos come from suppliers / OEMs.
   The default `sizes` matches the catalog and homepage card grid:
     1 col under 480px, 2 col under 820px, 3 col through 1280px, 4 col
   above. Tied to the product-grid breakpoints in globals.css. */
export default function ProductImage({
  imageUrl,
  icon,
  name,
  priority = false,
  sizes = "(max-width: 480px) 100vw, (max-width: 820px) 50vw, (max-width: 1280px) 33vw, 25vw",
}: {
  imageUrl?: string | null;
  icon: string;
  name: string;
  priority?: boolean;
  sizes?: string;
}) {
  if (imageUrl) {
    return (
      <Image
        className="pi-photo"
        src={imageUrl}
        alt={name}
        width={400}
        height={400}
        sizes={sizes}
        quality={72}
        priority={priority}
        loading={priority ? undefined : "lazy"}
      />
    );
  }
  return <PartIcon icon={icon} />;
}
