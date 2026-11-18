import prisma from "../db.server";

/** Railway health check: app is up and the database answers. */
export const loader = async () => {
  await prisma.$queryRaw`SELECT 1`;
  return new Response("ok");
};
