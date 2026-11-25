// Enlaces de reseña de Google. No requiere Business Profile API: solo el Place ID.
// https://developers.google.com/maps/documentation/places/web-service/place-id
const PLACE_ID_RE = /^[A-Za-z0-9_-]{10,255}$/;

export function isValidPlaceId(placeId: string): boolean {
  return PLACE_ID_RE.test(placeId);
}

/** URL directa para escribir una reseña. Devuelve null si el Place ID no es válido. */
export function buildGoogleReviewUrl(placeId: string): string | null {
  const id = placeId.trim();
  if (!isValidPlaceId(id)) return null;
  return `https://search.google.com/local/writereview?placeid=${encodeURIComponent(id)}`;
}
