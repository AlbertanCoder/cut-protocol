const express = require("express");
const { prisma } = require("../lib/prisma.js");
const { requireAuth } = require("../lib/auth.js");

const router = express.Router();
router.use(requireAuth);

router.get("/", async (req, res) => {
  const foods = await prisma.food.findMany({ orderBy: [{ category: "asc" }, { name: "asc" }] });
  res.json(foods);
});

module.exports = router;
