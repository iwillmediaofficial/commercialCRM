// Advertising platforms a DM client can be enrolled on. Stored lowercase in clients.ad_platforms.
export const AD_PLATFORMS: [string, string][] = [
  ["meta", "Meta"],
  ["google", "Google"],
  ["youtube", "YouTube"],
  ["linkedin", "LinkedIn"],
  ["other", "Other"],
];

export function platformLabel(key: string) {
  return AD_PLATFORMS.find(([k]) => k === key.toLowerCase())?.[1] ?? key;
}
