import { Router, type IRouter } from "express";
import healthRouter from "./health";
import setupRouter from "./setup";

const router: IRouter = Router();

router.use(healthRouter);
router.use(setupRouter);

export default router;
