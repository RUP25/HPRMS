export type Variant = { label: string; price: number };

export type MenuItem = {
  id: string;
  category: string;
  outlet: string;
  station: string;
  name: string;
  description: string | null;
  veg: boolean | null;
  variants: Variant[];
};

export type Category = {
  id: string;
  outlet: string;
  name: string;
  icon?: string;
  items: MenuItem[];
};

export type MenuPayload = {
  outlets: Record<string, { name: string; station: string }>;
  categories: Category[];
};

export type ConfigPayload = {
  hotel?: string;
  gst_percent: number;
  service_charge_percent: number;
};

export type TablePayload = {
  id: number;
  label: string;
  outlet?: string;
};

export type CartLine = {
  menu_item_id: string;
  variant_label: string;
  name: string;
  unit_price: number;
  qty: number;
};
