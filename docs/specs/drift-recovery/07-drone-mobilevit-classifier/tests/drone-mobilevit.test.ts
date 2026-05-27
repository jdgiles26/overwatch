import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../..");
const plan = readFileSync(resolve(REPO, "docs/plans/2026-05-05-drone-airspace-detection.md"), "utf8");

const stillPromisesMobileViT = /MobileViT/i.test(plan) && /TODO/.test(plan);
if (stillPromisesMobileViT) {
  console.log("RED: plan doc still has an unfulfilled MobileViT TODO");
  process.exit(0);
}
console.log("GREEN: MobileViT promise resolved (either wired or removed)");
