import { Router } from "express";
import { authenticateToken } from "../middlewares/auth.js";
import {
  listUsers,
  updateUser,
  deleteUser,
} from "../controllers/admin.users.controller.js";

const router = Router();

router.get("/admin/users", authenticateToken, listUsers);
router.post("/admin/update-user", authenticateToken, updateUser);
router.post("/admin/delete-user", authenticateToken, deleteUser);

export default router;