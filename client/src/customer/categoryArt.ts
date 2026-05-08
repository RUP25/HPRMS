/**
 * Per-category hero plates for the menu book (Unsplash; requires network).
 * Falls back to icon-based art, then picsum by id.
 */
export const CATEGORY_ART_BY_ID: Record<string, string> = {
  /* ----- Klong bar (hero images matched to spirit type; avoids beer/cocktail on whisky rows) ----- */
  single_malts:
    'https://images.unsplash.com/photo-1764690743246-6deafe4ad9fe?auto=format&fit=crop&w=720&q=75',
  indian_malts:
    'https://images.unsplash.com/photo-1716043657247-1d64eb36dba6?auto=format&fit=crop&w=720&q=75',
  bourbon:
    'https://images.unsplash.com/photo-1650431850505-291152c1c1ab?auto=format&fit=crop&w=720&q=75',
  tennessee_japanese:
    'https://images.unsplash.com/photo-1718881951099-759d473a3dd5?auto=format&fit=crop&w=720&q=75',
  irish:
    'https://images.unsplash.com/photo-1775233199599-e69769c089af?auto=format&fit=crop&w=720&q=75',
  deluxe_scotch:
    'https://images.unsplash.com/photo-1746422029200-51af8d27a0da?auto=format&fit=crop&w=720&q=75',
  blended_scotch:
    'https://images.unsplash.com/photo-1775056881030-5fc8ec5009b2?auto=format&fit=crop&w=720&q=75',
  imfl:
    'https://images.unsplash.com/photo-1716719215097-a6a640fc3225?auto=format&fit=crop&w=720&q=75',
  beers:
    'https://images.unsplash.com/photo-1725148029785-397acd3c1be3?auto=format&fit=crop&w=720&q=75',
  rum:
    'https://images.unsplash.com/photo-1773394089881-979ff780b1b2?auto=format&fit=crop&w=720&q=75',
  tequila:
    'https://images.unsplash.com/photo-1698288547419-407ca6bafe2a?auto=format&fit=crop&w=720&q=75',
  brandy:
    'https://images.unsplash.com/photo-1588868626049-6e8bd50be367?auto=format&fit=crop&w=720&q=75',
  breezers:
    'https://images.unsplash.com/photo-1645387492367-80c5841894fb?auto=format&fit=crop&w=720&q=75',
  vodka:
    'https://images.unsplash.com/photo-1720293099417-bd8276ff6db6?auto=format&fit=crop&w=720&q=75',
  gin:
    'https://images.unsplash.com/photo-1618593911390-44f58997c8ff?auto=format&fit=crop&w=720&q=75',
  liqueur:
    'https://images.unsplash.com/photo-1763050264512-530b62e5c1b0?auto=format&fit=crop&w=720&q=75',
  rum_cocktails:
    'https://images.unsplash.com/photo-1556679343-c7306c1976bc?auto=format&fit=crop&w=720&q=75',
  gin_cocktails:
    'https://images.unsplash.com/photo-1617524455170-ca63c7f0d472?auto=format&fit=crop&w=720&q=75',
  vodka_cocktails:
    'https://images.unsplash.com/photo-1467003909585-2f8a72700288?auto=format&fit=crop&w=720&q=75',
  whisky_cocktails:
    'https://images.unsplash.com/photo-1665935864412-5aa250c24ed0?auto=format&fit=crop&w=720&q=75',
  tequila_cocktails:
    'https://images.unsplash.com/photo-1513558161293-cdaf765ed2fd?auto=format&fit=crop&w=720&q=75',
  shooters:
    'https://images.unsplash.com/photo-1774290686673-ae86f40f1f9d?auto=format&fit=crop&w=720&q=75',
  mocktails:
    'https://images.unsplash.com/photo-1484980972926-edee96e0960d?auto=format&fit=crop&w=720&q=75',
  wines:
    'https://images.unsplash.com/photo-1510812431401-41d2bd2722f3?auto=format&fit=crop&w=720&q=75',

  /* ----- Dopwai restaurant ----- */
  soup:
    'https://images.unsplash.com/photo-1643786661490-966f1877effa?auto=format&fit=crop&w=720&q=75',
  salad:
    'https://images.unsplash.com/photo-1512621776951-a57141f2eefd?auto=format&fit=crop&w=720&q=75',
  starters_indian:
    'https://images.unsplash.com/photo-1567188040759-fb8a883dc6d8?auto=format&fit=crop&w=720&q=75',
  starters_conti:
    'https://images.unsplash.com/photo-1544025162-d76694265947?auto=format&fit=crop&w=720&q=75',
  starters_panasian:
    'https://images.unsplash.com/photo-1498654896293-37aacf113fd9?auto=format&fit=crop&w=720&q=75',
  starters_nv_indian:
    'https://images.unsplash.com/photo-1603894584373-5ac82b2ae398?auto=format&fit=crop&w=720&q=75',
  starters_nv_conti:
    'https://images.unsplash.com/photo-1558030006-450675393462?auto=format&fit=crop&w=720&q=75',
  starters_nv_panasian:
    'https://images.unsplash.com/photo-1776144177264-4bb62adac1b4?auto=format&fit=crop&w=720&q=75',
  pulses:
    'https://images.unsplash.com/photo-1777613112793-4fb0717c193b?auto=format&fit=crop&w=720&q=75',
  main_veg_indian:
    'https://images.unsplash.com/photo-1631292784640-2b24be784d5d?auto=format&fit=crop&w=720&q=75',
  main_veg_conti:
    'https://images.unsplash.com/photo-1540189549336-e6e99c3679fe?auto=format&fit=crop&w=720&q=75',
  main_veg_panasian:
    'https://images.unsplash.com/photo-1587040690786-b091531837a2?auto=format&fit=crop&w=720&q=75',
  main_nv_indian:
    'https://images.unsplash.com/photo-1708782344490-9026aaa5eec7?auto=format&fit=crop&w=720&q=75',
  main_nv_conti:
    'https://images.unsplash.com/photo-1546833999-b9f581a1996d?auto=format&fit=crop&w=720&q=75',
  main_nv_panasian:
    'https://images.unsplash.com/photo-1553621042-f6e147245754?auto=format&fit=crop&w=720&q=75',
  rice:
    'https://images.unsplash.com/photo-1589302168068-964664d93dc0?auto=format&fit=crop&w=720&q=75',
  noodles:
    'https://images.unsplash.com/photo-1612874742237-6526221588e3?auto=format&fit=crop&w=720&q=75',
  pasta:
    'https://images.unsplash.com/photo-1621996346565-e3dbc646d9a9?auto=format&fit=crop&w=720&q=75',
  breads:
    'https://images.unsplash.com/photo-1509440159596-0249088772ff?auto=format&fit=crop&w=720&q=75',
  northeast:
    'https://images.unsplash.com/photo-1742281257707-0c7f7e5ca9c6?auto=format&fit=crop&w=720&q=75',
  newly_added:
    'https://images.unsplash.com/photo-1414235077428-338989a2e8c0?auto=format&fit=crop&w=720&q=75',
  snacks:
    'https://images.unsplash.com/photo-1555939594-58d7cb561ad1?auto=format&fit=crop&w=720&q=75',
  momo:
    'https://images.unsplash.com/photo-1694923450868-b432a8ee52aa?auto=format&fit=crop&w=720&q=75',
  dessert:
    'https://images.unsplash.com/photo-1551024506-0bccd828d307?auto=format&fit=crop&w=720&q=75',
  beverages:
    'https://images.unsplash.com/photo-1544145945-f90425340c7e?auto=format&fit=crop&w=720&q=75',
  coffee:
    'https://images.unsplash.com/photo-1497935586351-b67a49e012bf?auto=format&fit=crop&w=720&q=75',
};

/** Fallback when a category id is not listed (e.g. dynamic categories). */
export const CATEGORY_ART: Record<string, string> = {
  soup: 'https://images.unsplash.com/photo-1643786661490-966f1877effa?auto=format&fit=crop&w=720&q=75',
  salad: 'https://images.unsplash.com/photo-1512621776951-a57141f2eefd?auto=format&fit=crop&w=720&q=75',
  starter:
    'https://images.unsplash.com/photo-1555939594-58d7cb561ad1?auto=format&fit=crop&w=720&q=75',
  main: 'https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?auto=format&fit=crop&w=720&q=75',
  rice: 'https://images.unsplash.com/photo-1589302168068-964664d93dc0?auto=format&fit=crop&w=720&q=75',
  noodles: 'https://images.unsplash.com/photo-1612874742237-6526221588e3?auto=format&fit=crop&w=720&q=75',
  pasta: 'https://images.unsplash.com/photo-1621996346565-e3dbc646d9a9?auto=format&fit=crop&w=720&q=75',
  bread: 'https://images.unsplash.com/photo-1509440159596-0249088772ff?auto=format&fit=crop&w=720&q=75',
  dessert: 'https://images.unsplash.com/photo-1551024506-0bccd828d307?auto=format&fit=crop&w=720&q=75',
  beverage: 'https://images.unsplash.com/photo-1544145945-f90425340c7e?auto=format&fit=crop&w=720&q=75',
  whisky: 'https://images.unsplash.com/photo-1576457688495-a1ee90ba9c91?auto=format&fit=crop&w=720&q=75',
  beer: 'https://images.unsplash.com/photo-1725148029785-397acd3c1be3?auto=format&fit=crop&w=720&q=75',
  rum: 'https://images.unsplash.com/photo-1773394089881-979ff780b1b2?auto=format&fit=crop&w=720&q=75',
  tequila: 'https://images.unsplash.com/photo-1698288547419-407ca6bafe2a?auto=format&fit=crop&w=720&q=75',
  brandy: 'https://images.unsplash.com/photo-1588868626049-6e8bd50be367?auto=format&fit=crop&w=720&q=75',
  vodka: 'https://images.unsplash.com/photo-1720293099417-bd8276ff6db6?auto=format&fit=crop&w=720&q=75',
  gin: 'https://images.unsplash.com/photo-1618593911390-44f58997c8ff?auto=format&fit=crop&w=720&q=75',
  wine: 'https://images.unsplash.com/photo-1510812431401-41d2bd2722f3?auto=format&fit=crop&w=720&q=75',
  cocktail: 'https://images.unsplash.com/photo-1551538827-9c037cb4f32a?auto=format&fit=crop&w=720&q=75',
  mocktail: 'https://images.unsplash.com/photo-1484980972926-edee96e0960d?auto=format&fit=crop&w=720&q=75',
};

export function categoryImageUrl(icon?: string, categoryId?: string): string {
  if (categoryId && CATEGORY_ART_BY_ID[categoryId]) {
    return CATEGORY_ART_BY_ID[categoryId];
  }
  if (icon && CATEGORY_ART[icon]) return CATEGORY_ART[icon];
  const seed = encodeURIComponent(categoryId || icon || 'menu');
  return `https://picsum.photos/seed/${seed}/600/600`;
}
