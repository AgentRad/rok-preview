import PartIcon from "./PartIcon";

/* Renders a real product photo when available; otherwise a clean
   line-art fallback. Photos come from suppliers / OEMs. */
export default function ProductImage({
  imageUrl,
  icon,
  name,
}: {
  imageUrl?: string | null;
  icon: string;
  name: string;
}) {
  if (imageUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img className="pi-photo" src={imageUrl} alt={name} loading="lazy" />;
  }
  return <PartIcon icon={icon} />;
}
