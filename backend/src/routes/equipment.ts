import { Router, Request, Response } from "express";
import { Equipment } from "../models";
import { authenticate, requireAdmin, AuthRequest } from "../middleware/auth";

const router = Router();

// GET /api/equipment — public list grouped by category
router.get("/", async (_req: Request, res: Response) => {
  const items = await Equipment.findAll({ order: [["sortOrder", "ASC"], ["createdAt", "ASC"]] });
  const categories = new Map<string, { desc: string; items: typeof items }>();
  for (const item of items) {
    if (!categories.has(item.category)) {
      categories.set(item.category, { desc: item.categoryDesc, items: [] });
    }
    categories.get(item.category)!.items.push(item);
  }
  const result = Array.from(categories.entries()).map(([category, { desc, items }]) => ({
    category,
    desc,
    items,
  }));
  res.json(result);
});

// PUT /api/equipment — admin bulk save (replaces all)
router.put("/", authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
  const data = req.body.equipment as any[] | undefined;
  if (!Array.isArray(data)) {
    res.status(400).json({ message: "无效的数据格式" });
    return;
  }
  await Equipment.destroy({ where: {}, truncate: true });
  const created = await Equipment.bulkCreate(
    data.map((item, i) => ({
      id: item.id || undefined,
      category: item.category || "",
      categoryDesc: item.categoryDesc || "",
      name: item.name,
      spec: item.spec || "",
      intro: item.intro || "",
      image: item.image || "",
      link: item.link || "",
      sortOrder: item.sortOrder ?? i,
    })),
    { validate: true }
  );
  res.json(created);
});

export default router;
