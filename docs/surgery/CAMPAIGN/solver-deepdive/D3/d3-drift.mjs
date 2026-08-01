import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const LIB = "C:/Users/<account>/Desktop/cut-protocol/backend/src/lib/";
const { PrismaClient } = require("C:/Users/<account>/Desktop/cut-protocol/backend/node_modules/@prisma/client");
const { isExcluded, FOOD_GATE_SELECT } = require(LIB + "exclusionGate.js");
const { macroTrustIssue } = require(LIB + "foodValidation.js");
const open = (p) => new PrismaClient({ datasources: { db: { url: "file:" + p } } });
const D3 = open("C:/Users/<account>/Desktop/cut-protocol/docs/surgery/CAMPAIGN/solver-deepdive/D3/d3.db");
const BASE = open("C:/Users/<account>/Desktop/cut-protocol/docs/surgery/CAMPAIGN/solver-brain/A20/dev.db");

const harsh = { dietaryStyle: "vegan", excludedFoods: ["soy","legumes","gluten","nuts","sesame"] };
for (const [label, db] of [["A20 fleet baseline e55f52e5", BASE], ["D3 live copy d9037dce", D3]]) {
  const all = await db.food.findMany({ select: FOOD_GATE_SELECT });
  const src = new Map(); for (const f of all) src.set(f.source, (src.get(f.source) || 0) + 1);
  const hp = all.filter((f) => f.protein >= 40);
  const hpTrusted = hp.filter((f) => !macroTrustIssue(f));
  const hpHarsh = hpTrusted.filter((f) => !isExcluded(f, harsh));
  console.log(`\n### ${label}`);
  console.log(`  rows=${all.length}  trusted=${all.filter((f)=>!macroTrustIssue(f)).length}  quarantined=${all.filter((f)=>macroTrustIssue(f)?.code==="quarantined").length}`);
  console.log(`  source dist: ${[...src.entries()].sort((a,b)=>b[1]-a[1]).map(([k,v])=>`${k}=${v}`).join("  ")}`);
  console.log(`  protein>=40: total=${hp.length} trusted=${hpTrusted.length} harsh-gate-clean=${hpHarsh.length}`);
  console.log(`  allergenTags populated: ${all.filter((f)=>f.allergenTags).length}   mayContain: ${all.filter((f)=>f.mayContain).length}`);
  console.log(`  top-5 harsh-clean by protein: ${hpHarsh.sort((a,b)=>b.protein-a.protein).slice(0,5).map((f)=>`${f.protein}=${f.name}`).join(" | ")}`);
  // the ten adjuster names
  const ten = await db.food.findMany({ where: { name: { in: ["Olive Oil","Butter","Avocado","White rice, cooked","Potatoes","Oats","Chicken breast, cooked, skinless","Greek Yogurt","Tofu","Lentils"] } }, select: FOOD_GATE_SELECT });
  console.log(`  adjuster names resolving: ${ten.length}/10; sources: ${ten.map((f)=>`${f.name}=${f.source}`).join(", ")}`);
  const survivors = ten.filter((f) => !macroTrustIssue(f) && !isExcluded(f, harsh));
  console.log(`  adjusters surviving harsh persona: ${survivors.length} (${survivors.map((f)=>f.name).join(", ")})`);
  await db.$disconnect();
}
