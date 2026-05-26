import Image from "next/image";
import PartIcon from "./PartIcon";

/* Renders a real product photo when available; otherwise a clean
   line-art fallback. Photos come from suppliers / OEMs. */
export default function ProductImage({
  imageUrl,
  icon,
  name,
  priority = false,
  sizes = "(max-width: 640px) 100vw, 320px",
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
        width={640}
        height={640}
        sizes={sizes}
        priority={priority}
        loading={priority ? undefined : "lazy"}
      />
    );
  }
  return <PartIcon icon={icon} />;
}
