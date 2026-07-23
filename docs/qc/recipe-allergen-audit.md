# Cut Protocol — recipe prose-vs-ingredient allergen audit

- Scanned 889 recipes. An allergen in the NAME or STEPS but NOT in the structured
  ingredient rows means the allergen filter (which reads ingredients) can't see it.
- Findings: **78** (high-confidence "Add'l ingredients:" declarations: **2**; incidental prose mentions: 76).
- By allergen: dairy 27, gluten 21, eggs 11, tree nuts 7, fish 5, sesame 4, peanuts 1, shellfish 1, soy 1

## High-confidence — a declared ingredient the importer dropped (fix the data)
| recipe | allergen | the dropped line |
|---|---|---|
| Beef Banh Mi Bowls with Sriracha Mayo, Carrot & Pi | dairy | `Add'l ingredients: mayonnaise, siracha  Place rice in a fine-mesh sieve and rins` |
| Beef Banh Mi Bowls with Sriracha Mayo, Carrot & Pi | eggs | `Add'l ingredients: mayonnaise, siracha  Place rice in a fine-mesh sieve and rins` |

## Incidental prose mentions (review — may be a garnish, an "optional", or a false hit)
| recipe | allergen |
|---|---|
| Elk Smokies & Potato | dairy |
| Angus Patty & Turkey Sausage Plate | dairy |
| Grilled Chicken Breast & Perogies | dairy |
| Beef Brisket Pot Roast | eggs |
| Beef Dumpling Stew | fish |
| Beef Mandi | dairy |
| Beef Mechado | sesame |
| Montreal Smoked Meat | gluten |
| Tafelspitz | gluten |
| Chicken Fried Rice | dairy |
| Chicken Ham and Leek Pie | gluten |
| Chicken Mandi | dairy |
| Chicken wings with cumin, lemon & garlic | tree nuts |
| Apple & Blackberry Crumble | gluten |
| Apple cake | tree nuts |
| Authentic Norwegian Kransekake | gluten |
| Banana den Forno | dairy |
| BeaverTails | tree nuts |
| Blackberry Fool | tree nuts |
| Choc Chip Pecan Pie | gluten |
| Coconut Natilla Recipe | eggs |
| Cornes de Gazelle (Gazelle Horns) | gluten |
| Dutch Apple Pie | gluten |
| Eccles Cakes | gluten |
| Ensaimada | dairy |
| Jamaican Sweet Potato Pudding | gluten |
| Mamoul (Eid biscuits) | sesame |
| Peach & Blueberry Grunt | gluten |
| Rock Cakes | gluten |
| Salted Caramel Cheescake | eggs |
| Seri muka kuih | dairy |
| Summer Pudding | dairy |
| Traditional Dutch rice tart (rijstevlaai) | dairy |
| Lamb Tagine | tree nuts |
| Spaghetti alla Carbonara | dairy |
| BBQ Pork Sloppy Joes | dairy |
| Hot and Sour Soup | eggs |
| Lao Naem Khao | eggs |
| Raspeballer (Norwegian Potato Dumplings) | gluten |
| Amok Trey – Cambodian Fish Curry | dairy |

_Generated 2026-07-23T07:19:07.112Z. Report-only — no recipe data was modified. The defence-in-depth fix (have the allergen filter also parse the "Add'l ingredients:" line) is applied in dietaryFilter; this audit finds what still needs the data itself corrected._
