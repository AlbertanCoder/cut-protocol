import { createRequire } from "node:module";
const require = createRequire("C:/Users/<account>/Desktop/cut-protocol/backend/");
const { prisma } = require("./src/lib/prisma.js");
const foods = await prisma.food.findMany({ select: { id:true, name:true, kcal:true, protein:true } });
const dead = (f) => (f.kcalPer100g > 0 && f.proteinPer100g > 0 ? f.proteinPer100g / f.kcalPer100g : 0);
const real = (f) => (f.kcal > 0 && f.protein > 0 ? f.protein / f.kcal : 0);
const cols = await prisma.$queryRawUnsafe("PRAGMA table_info(Food)");
const top = foods.map(f=>({n:f.name,d:real(f)})).sort((a,b)=>b.d-a.d).slice(0,3);
console.log(JSON.stringify({
  db: process.env.DATABASE_URL,
  foodRows: foods.length,
  maxDeadExpr: Math.max(0, ...foods.map(dead)),
  rowsWithNonzeroDeadExpr: foods.filter(f=>dead(f)>0).length,
  maxRealExpr: +Math.max(0, ...foods.map(real)).toFixed(4),
  topReal: top.map(t=>`${t.n} = ${t.d.toFixed(4)}`),
  hasKcalPer100g: cols.some(c=>c.name==="kcalPer100g"),
  hasProteinPer100g: cols.some(c=>c.name==="proteinPer100g")
}, null, 1));
await prisma.$disconnect();
