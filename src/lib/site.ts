import { useEffect, useState } from "react";
import { supabase } from "./supabase";

export type PlanModule = "leads" | "work" | "invoicing" | "ad_funds";

export type SitePlan = {
  name: string;
  description: string | null;
  price_monthly: number | null;
  price_quarterly: number | null;
  price_half_yearly: number | null;
  price_yearly: number | null;
  staff_limit: number | null;
  client_limit: number | null;
  modules: PlanModule[];
};

// What public_site_info() returns. Works without signing in.
export type SiteInfo = {
  product_name: string;
  support_email: string | null;
  support_phone: string | null;
  seller_name: string | null;
  seller_address: string | null;
  seller_gstin: string | null;
  trial_days: number | null;
  grace_days: number | null;
  legal_updated_on: string | null;
  plans: SitePlan[];
};

export const FALLBACK_PRODUCT_NAME = "Agency CRM";

// One request per page load, shared by every component that asks.
let cache: Promise<SiteInfo | null> | null = null;

function load() {
  cache ??= Promise.resolve(supabase.rpc("public_site_info")).then(
    ({ data, error }) => {
      if (error || !data || typeof data !== "object") return null;
      const info = data as unknown as SiteInfo;
      return { ...info, product_name: info.product_name || FALLBACK_PRODUCT_NAME, plans: info.plans ?? [] };
    },
    () => null,
  );
  return cache;
}

export function useSiteInfo(): SiteInfo | null {
  const [info, setInfo] = useState<SiteInfo | null>(null);
  useEffect(() => {
    let live = true;
    load().then((i) => live && setInfo(i));
    return () => {
      live = false;
    };
  }, []);
  return info;
}

// Product name to show right now, with a fallback while loading or on error.
export function productName(info: SiteInfo | null) {
  return info?.product_name || FALLBACK_PRODUCT_NAME;
}

// Digits only, for wa.me links. A bare 10-digit Indian number gets 91 in front.
export function whatsappNumber(phone: string) {
  const digits = phone.replace(/\D/g, "");
  return digits.length === 10 ? `91${digits}` : digits.replace(/^0+/, "");
}
