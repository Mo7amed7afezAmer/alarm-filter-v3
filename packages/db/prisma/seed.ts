// `prisma db seed` entry point (run by the compose `migrate` service).
import { PrismaClient } from "@prisma/client";
import { seed } from "../src/seed";

const db = new PrismaClient();

seed(db, process.env)
  .then((result) => console.log("seed:", JSON.stringify(result)))
  .catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
