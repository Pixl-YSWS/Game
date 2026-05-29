export interface ShopItem {
  id: string;
  name: string;
  price: number;
  // Emoji glyph used as the item's icon in the shop / inventory / when
  // placed in the house. Keeps us asset-free for item art.
  glyph: string;
  // Optional one-line description shown under the item name.
  blurb?: string;
  // If true, the item can be placed as furniture in the shared house
  // (consumed from inventory on placement, returned when picked back up).
  placeable?: boolean;
}

// Single shared catalog. Both client and server import this so they agree
// on prices — the server is still authoritative on the buy itself.
export const SHOP_CATALOG: ShopItem[] = [
  { id: "apple", name: "Apple", price: 5, glyph: "🍎", blurb: "Crunchy snack." },
  { id: "lantern", name: "Lantern", price: 15, glyph: "🏮", blurb: "Glows in the dark.", placeable: true },
  { id: "plant", name: "Potted Plant", price: 20, glyph: "🪴", blurb: "A little greenery.", placeable: true },
  { id: "torch", name: "Torch", price: 12, glyph: "🔥", blurb: "Warm flicker.", placeable: true },
  { id: "chair", name: "Chair", price: 25, glyph: "🪑", blurb: "Take a seat.", placeable: true },
  { id: "couch", name: "Couch", price: 45, glyph: "🛋️", blurb: "Lounge in style.", placeable: true },
  { id: "wood_sword", name: "Wood Sword", price: 50, glyph: "🗡️", blurb: "Better than nothing." },
  { id: "iron_pickaxe", name: "Iron Pickaxe", price: 100, glyph: "⛏️", blurb: "For sturdy stone." },
];

export function getShopItem(id: string): ShopItem | undefined {
  return SHOP_CATALOG.find(i => i.id === id);
}
