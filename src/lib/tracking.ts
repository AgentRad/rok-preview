/** Maps a carrier name to a public tracking URL when we recognize it. */
export function trackingLink(
  carrier: string | null | undefined,
  trackingCode: string | null | undefined
): string | null {
  if (!carrier || !trackingCode) return null;
  const code = encodeURIComponent(trackingCode.trim());
  const key = carrier.toLowerCase().trim();

  if (key.includes("fedex")) {
    return `https://www.fedex.com/fedextrack/?trknbr=${code}`;
  }
  if (key.includes("ups")) {
    return `https://www.ups.com/track?tracknum=${code}`;
  }
  if (key === "usps" || key.includes("postal")) {
    return `https://tools.usps.com/go/TrackConfirmAction?tLabels=${code}`;
  }
  if (key.includes("dhl")) {
    return `https://www.dhl.com/global-en/home/tracking/tracking-express.html?tracking-id=${code}`;
  }
  if (key.includes("ontrac")) {
    return `https://www.ontrac.com/tracking?number=${code}`;
  }
  if (key.includes("xpo")) {
    return `https://ltl.xpo.com/tracking?trackingNumbers=${code}`;
  }
  if (key.includes("estes")) {
    return `https://www.estes-express.com/myestes/shipment-tracking/?type=PRO&query=${code}`;
  }
  if (key.includes("saia")) {
    return `https://www.saia.com/track/details?proNumber=${code}`;
  }
  if (key.includes("yrc") || key.includes("yellow")) {
    return `https://my.yrc.com/dynamic/national/servlet?CONTROLLER=com.rdwy.ec.rextracking.http.controller.ProcessPublicTrackingController&PRONumberValue=${code}`;
  }
  return null;
}
