# Pool admission sweep — seeded pool, 2026-08-19

Database: isolated `rebuild-qa.db` built from migrations + the three seed scripts
(the same construction CI uses — NOT the owner's library).

| Gate | Count | of 688 |
|---|---:|---:|
| Admitted (resolution ✓ sanity ✓ trust ✓) | **559** | 81.3% |
| Failed resolution (ingredient without complete macros) | 0 | 0.0% |
| Failed sanity bounds | 129 | 18.8% |
| Sanity warnings only (admitted, flagged for curation) | 1 | 0.1% |
| Trust-excluded (existing quarantine rule) | 0 | 0.0% |
| Cached-vs-computed kcal drift >15% | 1 | 0.1% |

## Persona pools (over the ADMITTED set)

| Persona | Pool | Meal-eligible | Snack-eligible |
|---|---:|---:|---:|
| P0 — founder profile — shellfish/gluten/kiwi/soy | 230 | 186 | 21 |
| P1 — celiac vegan | 39 | 29 | 6 |
| P2 — soy + wheat allergy | 247 | 203 | 21 |
| P3 — keto | 35 | 32 | 4 |
| P5 — pescatarian | 559 | 412 | 22 |
| P6 — lactose-intolerant (dairy wall) | 285 | 253 | 13 |

## Sanity failures, in full

- **Street Chili** (curated) — 1484 kcal/serving is past the 1400 kcal recipe ceiling; 161 g protein/serving is past the 100 g recipe ceiling
- **Arepa Pabellón** (themealdb-import) — 1572 kcal/serving is past the 1400 kcal recipe ceiling
- **Beef and Mustard Pie** (themealdb-import) — 1747 kcal/serving is past the 1400 kcal recipe ceiling
- **Beef Asado** (themealdb-import) — 110 g protein/serving is past the 100 g recipe ceiling
- **Beef Brisket Pot Roast** (themealdb-import) — 1952 kcal/serving is past the 1400 kcal recipe ceiling; 123 g protein/serving is past the 100 g recipe ceiling
- **Beef pumpkin Stew** (themealdb-import) — 2478 kcal/serving is past the 1400 kcal recipe ceiling; 158 g protein/serving is past the 100 g recipe ceiling
- **Bigos (Polish hunter's stew)** (themealdb-import) — 1621 kcal/serving is past the 1400 kcal recipe ceiling
- **Brun Lapskaus (Norwegian Beef Vegetable Stew)** (themealdb-import) — 1606 kcal/serving is past the 1400 kcal recipe ceiling
- **Corned Beef and Cabbage** (themealdb-import) — 2268 kcal/serving is past the 1400 kcal recipe ceiling; 122 g protein/serving is past the 100 g recipe ceiling
- **Cumberland Pie** (themealdb-import) — 1645 kcal/serving is past the 1400 kcal recipe ceiling
- **Egyptian Fatteh** (themealdb-import) — 2062 kcal/serving is past the 1400 kcal recipe ceiling
- **Jamaican Beef Patties** (themealdb-import) — 1823 kcal/serving is past the 1400 kcal recipe ceiling
- **Jiggs Dinner** (themealdb-import) — 2087 kcal/serving is past the 1400 kcal recipe ceiling; 125 g protein/serving is past the 100 g recipe ceiling
- **Paszteciki (Polish Pasties)** (themealdb-import) — 1806 kcal/serving is past the 1400 kcal recipe ceiling
- **Potato Moussaka Recipe** (themealdb-import) — 2087 kcal/serving is past the 1400 kcal recipe ceiling
- **Red Peas Soup** (themealdb-import) — 1504 kcal/serving is past the 1400 kcal recipe ceiling; 110 g protein/serving is past the 100 g recipe ceiling
- **Satee** (themealdb-import) — 2171 kcal/serving is past the 1400 kcal recipe ceiling; 128 g protein/serving is past the 100 g recipe ceiling
- **Chicken Fried Rice** (themealdb-import) — 1467 kcal/serving is past the 1400 kcal recipe ceiling
- **Chicken Ham and Leek Pie** (themealdb-import) — 2092 kcal/serving is past the 1400 kcal recipe ceiling
- **Chicken wings with cumin, lemon & garlic** (themealdb-import) — 84 kcal/serving is below the 150 kcal recipe floor
- **Chinese Orange Chicken** (themealdb-import) — 2174 kcal/serving is past the 1400 kcal recipe ceiling
- **Crock Pot Chicken Baked Tacos** (themealdb-import) — 1898 kcal/serving is past the 1400 kcal recipe ceiling
- **French Onion Chicken with Roasted Carrots & Mashed Potatoes** (themealdb-import) — 2033 kcal/serving is past the 1400 kcal recipe ceiling
- **Jerk chicken with rice & peas** (themealdb-import) — 2272 kcal/serving is past the 1400 kcal recipe ceiling
- **Pollo en pepitoria** (themealdb-import) — 1604 kcal/serving is past the 1400 kcal recipe ceiling
- **Potato Gratin with Chicken** (themealdb-import) — 1768 kcal/serving is past the 1400 kcal recipe ceiling
- **Roasted chicken with creamy walnut sauce** (themealdb-import) — 2086 kcal/serving is past the 1400 kcal recipe ceiling
- **Shawarma** (themealdb-import) — 1783 kcal/serving is past the 1400 kcal recipe ceiling
- **Spanish chicken pie** (themealdb-import) — 1510 kcal/serving is past the 1400 kcal recipe ceiling
- **Spiced smoky barbecued chicken** (themealdb-import) — 1964 kcal/serving is past the 1400 kcal recipe ceiling
- **Arnhemse meisjes** (themealdb-import) — 143 kcal/serving is below the 150 kcal recipe floor
- **Banana Pancakes** (themealdb-import) — 86 kcal/serving is below the 150 kcal recipe floor
- **Blueberry & lemon friands** (themealdb-import) — 106 kcal/serving is below the 150 kcal recipe floor
- **Churros** (themealdb-import) — 1604 kcal/serving is past the 1400 kcal recipe ceiling
- **Grape Nut Ice Cream** (themealdb-import) — 83 kcal/serving is below the 150 kcal recipe floor
- **Peanut Butter Cheesecake** (themealdb-import) — 1448 kcal/serving is past the 1400 kcal recipe ceiling
- **Sticky Toffee Pudding Ultimate** (themealdb-import) — water: 2187.5 g per serving is past the 1500 g plausibility bound
- **Strawberries Romanoff** (themealdb-import) — 144 kcal/serving is below the 150 kcal recipe floor
- **Tall Skoleboller** (themealdb-import) — 1531 kcal/serving is past the 1400 kcal recipe ceiling
- **Imam bayildi with BBQ lamb & tzatziki** (themealdb-import) — 1991 kcal/serving is past the 1400 kcal recipe ceiling
- **Lamb and Potato pie** (themealdb-import) — Vegetable Stock: 8750 g per serving is past the 1500 g plausibility bound; 2388 kcal/serving is past the 1400 kcal recipe ceiling; 217 g protein/serving is past the 100 g recipe ceiling
- **Lancashire hotpot** (themealdb-import) — 1548 kcal/serving is past the 1400 kcal recipe ceiling
- **Mastawa Lamb and Rice** (themealdb-import) — 1465 kcal/serving is past the 1400 kcal recipe ceiling
- **McSinghs Scotch pie** (themealdb-import) — 1618 kcal/serving is past the 1400 kcal recipe ceiling
- **Muraba-E-Kadu (Pumpkin Jam)** (themealdb-import) — 1475 kcal/serving is past the 1400 kcal recipe ceiling
- **Ramen Noodles with Boiled Egg** (themealdb-import) — 72 kcal/serving is below the 150 kcal recipe floor
- **Shakshuka Feta Cheese** (themealdb-import) — 135 kcal/serving is below the 150 kcal recipe floor
- **Grilled Mac and Cheese Sandwich** (themealdb-import) — 1619 kcal/serving is past the 1400 kcal recipe ceiling
- **Lasagne** (themealdb-import) — 1872 kcal/serving is past the 1400 kcal recipe ceiling
- **Venetian Duck Ragu** (themealdb-import) — 1924 kcal/serving is past the 1400 kcal recipe ceiling
- **Arroz al horno (baked rice)** (themealdb-import) — 104 g protein/serving is past the 100 g recipe ceiling
- **Boxty Breakfast** (themealdb-import) — 1638 kcal/serving is past the 1400 kcal recipe ceiling
- **Chickpea, chorizo & spinach stew** (themealdb-import) — 1434 kcal/serving is past the 1400 kcal recipe ceiling
- **Chilean Empanada** (themealdb-import) — 1562 kcal/serving is past the 1400 kcal recipe ceiling
- **Pork rib bortsch** (themealdb-import) — 1501 kcal/serving is past the 1400 kcal recipe ceiling
- **Raspeballer (Norwegian Potato Dumplings)** (themealdb-import) — 1730 kcal/serving is past the 1400 kcal recipe ceiling
- **Slow-roasted ham with lemon, garlic & sage** (themealdb-import) — 113 g protein/serving is past the 100 g recipe ceiling
- **Stamppot** (themealdb-import) — 1844 kcal/serving is past the 1400 kcal recipe ceiling
- **Sweet and Sour Pork** (themealdb-import) — 110 kcal/serving is below the 150 kcal recipe floor
- **Trinxat (Potato, Cabbage and Bacon Hash)** (themealdb-import) — 135 kcal/serving is below the 150 kcal recipe floor
- **Arroz con gambas y calamar** (themealdb-import) — 2387 kcal/serving is past the 1400 kcal recipe ceiling; 114 g protein/serving is past the 100 g recipe ceiling
- **Bang bang prawn salad** (themealdb-import) — 133 kcal/serving is below the 150 kcal recipe floor
- **Camaro Grelhado Com Molho Cru (Grilled Prawns with Green Onion Sauce)** (themealdb-import) — 136 kcal/serving is below the 150 kcal recipe floor
- **Clam, chorizo & white bean stew** (themealdb-import) — 1401 kcal/serving is past the 1400 kcal recipe ceiling
- **Crispy fried fish with ginger and fermented soybeans (trey chien chuon)** (themealdb-import) — 1439 kcal/serving is past the 1400 kcal recipe ceiling
- **Egg Foo Young** (themealdb-import) — 2432 kcal/serving is past the 1400 kcal recipe ceiling; 144 g protein/serving is past the 100 g recipe ceiling
- **Grilled Portuguese sardines** (themealdb-import) — 2008 kcal/serving is past the 1400 kcal recipe ceiling
- **Kung Po Prawns** (themealdb-import) — 147 kcal/serving is below the 150 kcal recipe floor
- **Napa Cabbage with Dried Shrimp** (themealdb-import) — 126 kcal/serving is below the 150 kcal recipe floor
- **Paella** (themealdb-import) — 1851 kcal/serving is past the 1400 kcal recipe ceiling
- **Salmon Avocado Salad** (themealdb-import) — 1860 kcal/serving is past the 1400 kcal recipe ceiling
- **Seafood fideuà** (themealdb-import) — 2041 kcal/serving is past the 1400 kcal recipe ceiling
- **Sledz w Oleju (Polish Herrings)** (themealdb-import) — 2050 kcal/serving is past the 1400 kcal recipe ceiling
- **Thai-style steamed fish** (themealdb-import) — 141 kcal/serving is below the 150 kcal recipe floor
- **Vietnamese prawn spiralized rolls** (themealdb-import) — 1775 kcal/serving is past the 1400 kcal recipe ceiling
- **Air Fryer Egg Rolls** (themealdb-import) — 2194 kcal/serving is past the 1400 kcal recipe ceiling
- **Algerian Carrots** (themealdb-import) — 1908 kcal/serving is past the 1400 kcal recipe ceiling
- **Almojábanas (Colombian Cheese Bread)** (themealdb-import) — 1579 kcal/serving is past the 1400 kcal recipe ceiling
- **Bajan Salt Bread Recipe** (themealdb-import) — 1556 kcal/serving is past the 1400 kcal recipe ceiling
- **Bajan Sweet Bread** (themealdb-import) — 1921 kcal/serving is past the 1400 kcal recipe ceiling
- **Boulangère Potatoes** (themealdb-import) — 2238 kcal/serving is past the 1400 kcal recipe ceiling; 102 g protein/serving is past the 100 g recipe ceiling
- **Breadfruit in Butter Sauce** (themealdb-import) — 1403 kcal/serving is past the 1400 kcal recipe ceiling
- **Cheese Borek** (themealdb-import) — 2384 kcal/serving is past the 1400 kcal recipe ceiling
- **Chilean Dobladitas** (themealdb-import) — 1715 kcal/serving is past the 1400 kcal recipe ceiling
- **Colombian Buñuelos Recipe** (themealdb-import) — 1488 kcal/serving is past the 1400 kcal recipe ceiling
- **French Onion Soup** (themealdb-import) — 1476 kcal/serving is past the 1400 kcal recipe ceiling
- **Fresh sardines** (themealdb-import) — 2438 kcal/serving is past the 1400 kcal recipe ceiling
- **Jamaican Festival (Sweet Dumpling)** (themealdb-import) — 1507 kcal/serving is past the 1400 kcal recipe ceiling
- **Jamaican Fried Dumplings** (themealdb-import) — 2327 kcal/serving is past the 1400 kcal recipe ceiling
- **Khobz el Dar (Algerian Semolina Bread)** (themealdb-import) — 1647 kcal/serving is past the 1400 kcal recipe ceiling
- **Mango chow** (themealdb-import) — 91 kcal/serving is below the 150 kcal recipe floor
- **Mustard champ** (themealdb-import) — 2135 kcal/serving is past the 1400 kcal recipe ceiling
- **Num Ansom – Sticky Rice Cake** (themealdb-import) — 1538 kcal/serving is past the 1400 kcal recipe ceiling
- **Phaphatha Flatbreads** (themealdb-import) — 1477 kcal/serving is past the 1400 kcal recipe ceiling
- **Pierogi (Polish Dumplings)** (themealdb-import) — 1584 kcal/serving is past the 1400 kcal recipe ceiling
- **Runner Bean Mash (Snijbonen Stamppot)** (themealdb-import) — 1602 kcal/serving is past the 1400 kcal recipe ceiling
- **Smoked aubergine purée** (themealdb-import) — 115 kcal/serving is below the 150 kcal recipe floor
- **Snert (Dutch Split Pea Soup)** (themealdb-import) — 1505 kcal/serving is past the 1400 kcal recipe ceiling; 114 g protein/serving is past the 100 g recipe ceiling
- **Split Pea Soup** (themealdb-import) — Peas: 10000 g per serving is past the 1500 g plausibility bound; 1915 kcal/serving is past the 1400 kcal recipe ceiling; 2227 g protein/serving is past the 100 g recipe ceiling
- **Zemiakové Placky** (themealdb-import) — 1920 kcal/serving is past the 1400 kcal recipe ceiling
- **Broccoli & Stilton soup** (themealdb-import) — 1419 kcal/serving is past the 1400 kcal recipe ceiling
- **Clam chowder** (themealdb-import) — 1999 kcal/serving is past the 1400 kcal recipe ceiling
- **Colombian Style Stuffed Potatoes** (themealdb-import) — 2462 kcal/serving is past the 1400 kcal recipe ceiling; 105 g protein/serving is past the 100 g recipe ceiling
- **Mantu Afghan Dumpling** (themealdb-import) — 1605 kcal/serving is past the 1400 kcal recipe ceiling
- **Padron peppers** (themealdb-import) — 64 kcal/serving is below the 150 kcal recipe floor
- **Chtitha Batata (Algerian Potato Stew)** (themealdb-import) — 115 kcal/serving is below the 150 kcal recipe floor
- **Cottage Cheese And Feta Stuffed Peppers** (themealdb-import) — 133 kcal/serving is below the 150 kcal recipe floor
- **Creamy Aji green sauce** (themealdb-import) — 148 kcal/serving is below the 150 kcal recipe floor
- **Cucumber & fennel salad** (themealdb-import) — 88 kcal/serving is below the 150 kcal recipe floor
- **Egg Drop Soup** (themealdb-import) — 86 kcal/serving is below the 150 kcal recipe floor
- **Falafel Pita Sandwich with Tahini Sauce** (themealdb-import) — 1582 kcal/serving is past the 1400 kcal recipe ceiling
- **Ful Medames** (themealdb-import) — 117 kcal/serving is below the 150 kcal recipe floor
- **Gigantes Plaki** (themealdb-import) — 1629 kcal/serving is past the 1400 kcal recipe ceiling
- **Grilled eggplant with coconut milk** (themealdb-import) — 81 kcal/serving is below the 150 kcal recipe floor
- **Hodge Podge** (themealdb-import) — 1497 kcal/serving is past the 1400 kcal recipe ceiling
- **Kaspressknödel - Cheese Dumplings** (themealdb-import) — 1413 kcal/serving is past the 1400 kcal recipe ceiling
- **Rice and Beans** (themealdb-import) — 92 kcal/serving is below the 150 kcal recipe floor
- **Sichuan Eggplant** (themealdb-import) — 136 kcal/serving is below the 150 kcal recipe floor
- **Silken Tofu with Sesame Soy Sauce** (themealdb-import) — 100 kcal/serving is below the 150 kcal recipe floor
- **Tahini Lentils** (themealdb-import) — Kale: 2500 g per serving is past the 1500 g plausibility bound; Lentils: 6250 g per serving is past the 1500 g plausibility bound; 1425 kcal/serving is past the 1400 kcal recipe ceiling; 1552 g protein/serving is past the 100 g recipe ceiling
- **Tortang Talong** (themealdb-import) — 87 kcal/serving is below the 150 kcal recipe floor
- **Vietnamese-style veggie hotpot** (themealdb-import) — Green Beans: 2500 g per serving is past the 1500 g plausibility bound
- **Dutch poffertjes (mini pancakes)** (themealdb-import) — 1702 kcal/serving is past the 1400 kcal recipe ceiling
- **Grits** (themealdb-import) — 98 kcal/serving is below the 150 kcal recipe floor
- **Home-made Mandazi** (themealdb-import) — 2051 kcal/serving is past the 1400 kcal recipe ceiling
- **Oatmeal pancakes** (themealdb-import) — 1617 kcal/serving is past the 1400 kcal recipe ceiling
- **Rømmegrøt – Norwegian Sour Cream Porridge** (themealdb-import) — 1478 kcal/serving is past the 1400 kcal recipe ceiling
- **Smoked Haddock Kedgeree** (themealdb-import) — 2372 kcal/serving is past the 1400 kcal recipe ceiling; 159 g protein/serving is past the 100 g recipe ceiling
- **Torrijas with sherry** (themealdb-import) — 1743 kcal/serving is past the 1400 kcal recipe ceiling

## Resolution failures, in full


## Drift >15%, in full

- **Greek Yogurt, Almonds & Berries** — cached 495.1 vs computed 263.5 (87.9%)
