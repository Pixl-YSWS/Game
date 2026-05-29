export interface ShopItem {
  id: string;
  name: string;
  price: number;
  // Optional one-line description shown under the item name.
  blurb?: string;
}

// Single shared catalog. Both client and server import this so they agree
// on prices — the server is still authoritative on the buy itself.
export const SHOP_CATALOG: ShopItem[] = [
  { id: "apple", name: "Apple", price: 5, blurb: "Crunchy snack." },
  { id: "lantern", name: "Lantern", price: 15, blurb: "Glows in the dark." },
  { id: "wood_sword", name: "Wood Sword", price: 50, blurb: "Better than nothing." },
  { id: "iron_pickaxe", name: "Iron Pickaxe", price: 100, blurb: "For sturdy stone." },
];

export function getShopItem(id: string): ShopItem | undefined {
  return SHOP_CATALOG.find(i => i.id === id);
}
